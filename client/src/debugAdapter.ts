import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { CompilationError, compileSmallBasicProgram } from './compiler';

export class SmallBasicDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined, 
        config: vscode.DebugConfiguration, 
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // If no configuration is specified, create a default one
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'smallbasic') {
                config.type = 'smallbasic';
                config.name = 'Run Small Basic Program';
                config.request = 'launch';
                config.program = '${file}';
                config.compileOnly = false;
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage('Cannot find a Small Basic program to debug')
                .then(_ => {
                    return undefined; // Cancel debug session
                });
        }

        return config;
    }
}

export class SmallBasicDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(
        session: vscode.DebugSession, 
        executable: vscode.DebugAdapterExecutable | undefined
    ): Promise<vscode.DebugAdapterDescriptor> {
        // Log that we're creating a debug adapter
        console.log(`Creating debug adapter for session: ${session.id}, type: ${session.type}`);
        
        // Return our own implementation of the debug adapter
        const adapter = new SmallBasicDebugAdapter();
        return new vscode.DebugAdapterInlineImplementation(adapter);
    }
}

class SmallBasicDebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new vscode.EventEmitter<Uint8Array>();
    readonly onDidSendMessage: vscode.Event<Uint8Array> = this._onDidSendMessage.event;
    
    // Use VS Code's window instead of creating our own output channel
    // This will ensure debug messages appear in the Debug Console
    private outputChannel: vscode.OutputChannel;
    
    constructor() {
        console.log('Initializing Small Basic Debug Adapter');
        this.outputChannel = vscode.window.createOutputChannel('Small Basic Debug');
        this.outputChannel.show(true);
    }

    dispose(): void {
        this._onDidSendMessage.dispose();
    }

    handleMessage(message: any): void {
        console.log(`Debug adapter received message: ${message.command}`);
        this.outputChannel.appendLine(`Debug message received: ${message.command}`);
        
        // Handle initialize request
        if (message.command === 'initialize') {
            this.sendResponse({
                request_seq: message.seq,
                success: true,
                command: message.command,
                body: {
                    supportsConfigurationDoneRequest: true
                }
            });
            
            // Send initialized event
            this.sendEvent({
                type: 'event',
                event: 'initialized',
                seq: 0
            });
            return;
        }

        // Handle launch request (this is where we compile/run the Small Basic program)
        if (message.command === 'launch') {
            this.outputChannel.appendLine('Starting Small Basic program...');
            
            const program = message.arguments.program;
            this.outputChannel.appendLine(`Program file: ${program}`);
            
            // Launch the program asynchronously and don't block the debug adapter
            this.launchProgram(program, message.arguments.compileOnly || false, message);
            
            // We don't wait for program completion - respond immediately to keep debug protocol happy
            this.sendResponse({
                request_seq: message.seq,
                success: true,
                command: message.command
            });
            
            return;
        }

        // Handle standard debug protocol messages required for clean operation
        if (['threads', 'stackTrace', 'scopes', 'variables', 'configurationDone', 'disconnect'].includes(message.command)) {
            // For threads request, we need to return at least one thread
            if (message.command === 'threads') {
                this.sendResponse({
                    request_seq: message.seq,
                    success: true,
                    command: message.command,
                    body: {
                        threads: [{ id: 1, name: 'main' }]
                    }
                });
            } else {
                // For other simple requests, just acknowledge them
                this.sendResponse({
                    request_seq: message.seq,
                    success: true,
                    command: message.command
                });
            }
            return;
        }

        // For unhandled requests
        console.log(`Unhandled debug request: ${message.command}`);
        this.sendResponse({
            request_seq: message.seq,
            success: false,
            command: message.command,
            message: `Unrecognized request: ${message.command}`
        });
    }

    // Helper method to launch the Small Basic program
    private async launchProgram(programPath: string, compileOnly: boolean, request: any): Promise<void> {
        try {
            // Resolve any variables in the path (like ${file})
            const filePath = this.resolvePath(programPath);
            if (!filePath) {
                this.outputChannel.appendLine(`ERROR: Invalid program path: ${programPath}`);
                this.sendErrorResponse(request, 1001, `Invalid program path: ${programPath}`);
                this.sendTerminatedEvent();
                return;
            }

            this.outputChannel.appendLine(`Compiling: ${filePath}`);
            
            // Compile the program using our compiler module
            try {
                const result = await compileSmallBasicProgram(filePath, true);
                
                // Log the raw compiler output
                if (result.rawOutput) {
                    this.outputChannel.appendLine('COMPILER OUTPUT:');
                    this.outputChannel.appendLine('-------------------------------------------');
                    this.outputChannel.appendLine(result.rawOutput);
                    this.outputChannel.appendLine('-------------------------------------------');
                }
                
                if (result.success) {
                    this.outputChannel.appendLine(`Compilation successful: ${path.basename(filePath)}`);
                    
                    // Run the compiled program if not compile-only mode
                    if (!compileOnly && result.exePath && fs.existsSync(result.exePath)) {
                        this.outputChannel.appendLine(`Running: ${result.exePath}`);
                        
                        try {
                            // Use start command to launch the program (best for Windows GUI apps)
                            const exePath = result.exePath;
                            cp.exec(`start "" "${exePath}"`, {
                                cwd: path.dirname(exePath),
                                windowsHide: false
                            }, (error) => {
                                if (error) {
                                    this.outputChannel.appendLine(`Error launching program: ${error.message}`);
                                }
                            });
                            
                            this.outputChannel.appendLine('Program launched successfully');
                        } catch (error) {
                            this.outputChannel.appendLine(`Failed to launch program: ${error}`);
                        }
                    } else if (compileOnly) {
                        this.outputChannel.appendLine('Compile-only mode - program not started');
                    } else {
                        this.outputChannel.appendLine('ERROR: Compiled executable not found');
                    }
                } else {
                    this.outputChannel.appendLine(`Compilation failed with ${result.errors?.length || 0} errors`);
                    
                    if (result.errors && result.errors.length > 0) {
                        result.errors.forEach(error => {
                            if (error.line !== undefined) {
                                this.outputChannel.appendLine(`Line ${error.line}, Col ${error.column || 0}: ${error.message}`);
                            } else {
                                this.outputChannel.appendLine(`Error: ${error.message}`);
                            }
                        });
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error during compilation: ${error}`);
            }
            
            // Signal that debugging is complete
            this.sendTerminatedEvent();
            
        } catch (error) {
            this.outputChannel.appendLine(`Error in launch process: ${error}`);
            this.sendTerminatedEvent();
        }
    }

    private sendTerminatedEvent(): void {
        this.outputChannel.appendLine('Debug session completed');
        this.sendEvent({
            type: 'event',
            event: 'terminated',
            seq: 0
        });
    }

    // Helper methods
    private sendEvent(event: any): void {
        this._onDidSendMessage.fire(Buffer.from(JSON.stringify(event)));
    }

    private sendResponse(response: any): void {
        response.type = 'response';
        this._onDidSendMessage.fire(Buffer.from(JSON.stringify(response)));
    }

    private sendErrorResponse(request: any, errorCode: number, errorMessage: string): void {
        this.sendResponse({
            request_seq: request.seq,
            success: false,
            command: request.command,
            message: errorMessage,
            body: {
                error: {
                    id: errorCode,
                    format: errorMessage,
                    showUser: true
                }
            }
        });
    }

    private resolvePath(filePath: string): string | undefined {
        if (filePath.includes('${file}')) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                return filePath.replace('${file}', editor.document.uri.fsPath);
            }
            return undefined;
        }

        if (filePath.includes('${workspaceFolder}')) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                return filePath.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
            }
            return undefined;
        }

        return filePath;
    }

    private getErrorRange(document: vscode.TextDocument, error: CompilationError): vscode.Range {
        // If the error has line and column information, use that
        if (error.line !== undefined && error.column !== undefined) {
            const line = Math.max(0, error.line - 1); // Convert 1-based to 0-based
            const column = Math.max(0, error.column - 1); // Convert 1-based to 0-based
            
            // Get the length of the error token or use a default length
            const lineText = document.lineAt(line).text;
            const tokenMatch = lineText.substring(column).match(/\b\w+\b/);
            const tokenLength = tokenMatch ? tokenMatch[0].length : 1;
            
            return new vscode.Range(line, column, line, column + tokenLength);
        }

        // If we can detect the error line from the error message
        if (error.message) {
            // Try to extract line number from error message (common compiler error format)
            const lineMatch = error.message.match(/line\s+(\d+)/i);
            if (lineMatch && lineMatch[1]) {
                const line = parseInt(lineMatch[1], 10) - 1;
                if (line >= 0 && line < document.lineCount) {
                    return document.lineAt(line).range;
                }
            }
            
            // Try to find the error text in the document
            for (let i = 0; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text;
                
                // Look for any relevant error patterns in the line text
                const errorTextMatch = error.message.match(/'([^']+)'/);
                if (errorTextMatch && errorTextMatch[1] && lineText.includes(errorTextMatch[1])) {
                    const startChar = lineText.indexOf(errorTextMatch[1]);
                    return new vscode.Range(i, startChar, i, startChar + errorTextMatch[1].length);
                }
            }
        }

        // Fallback to highlighting the first line
        return document.lineAt(0).range;
    }
}
