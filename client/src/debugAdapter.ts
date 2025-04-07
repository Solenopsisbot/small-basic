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
        // Return our own implementation of the debug adapter
        const adapter = new SmallBasicDebugAdapter();
        return new vscode.DebugAdapterInlineImplementation(adapter);
    }
}

class SmallBasicDebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new vscode.EventEmitter<Uint8Array>();
    readonly onDidSendMessage: vscode.Event<Uint8Array> = this._onDidSendMessage.event;
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        // Create diagnostic collection for compiler errors
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('smallBasicCompiler');
    }

    dispose(): void {
        this._onDidSendMessage.dispose();
        this.diagnosticCollection.dispose();
    }

    async handleMessage(message: any): Promise<void> {
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
            const program = message.arguments.program;
            const compileOnly = message.arguments.compileOnly || false;
            const filePath = this.resolvePath(program);

            if (!filePath) {
                this.sendErrorResponse(message, 1001, `Invalid program path: ${program}`);
                return;
            }

            if (!fs.existsSync(filePath)) {
                this.sendErrorResponse(message, 1002, `Program file does not exist: ${filePath}`);
                return;
            }

            try {
                // Clear previous diagnostics
                this.diagnosticCollection.clear();

                // Compile the Small Basic program
                const result = await compileSmallBasicProgram(filePath);

                // Check for compilation errors
                if (!result.success && result.errors && result.errors.length > 0) {
                    // Display compilation errors
                    const document = await vscode.workspace.openTextDocument(filePath);
                    const diagnostics: vscode.Diagnostic[] = [];

                    for (const error of result.errors) {
                        const range = this.getErrorRange(document, error);
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Compilation error: ${error.message}`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostics.push(diagnostic);
                    }

                    this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
                    this.sendErrorResponse(message, 1003, 'Compilation failed with errors');
                    return;
                }

                // If it's compile-only mode, just send success
                if (compileOnly) {
                    vscode.window.showInformationMessage('Small Basic program compiled successfully');
                    this.sendResponse({
                        request_seq: message.seq,
                        success: true,
                        command: message.command
                    });
                } else {
                    // Run the compiled program
                    if (result.exePath && fs.existsSync(result.exePath)) {
                        vscode.window.showInformationMessage(`Running: ${path.basename(filePath)}`);

                        // Launch the executable as a detached process
                        const child = cp.spawn(result.exePath, [], {
                            detached: true,
                            stdio: 'ignore',
                            windowsHide: false
                        });
                        child.unref();

                        // Send success response
                        this.sendResponse({
                            request_seq: message.seq,
                            success: true,
                            command: message.command
                        });
                    } else {
                        this.sendErrorResponse(message, 1004, 'Compiled executable not found');
                        return;
                    }
                }

                // Terminate the debug session
                this.sendEvent({
                    type: 'event',
                    event: 'terminated',
                    seq: 0
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.sendErrorResponse(message, 1005, `Error: ${errorMessage}`);
            }
            return;
        }

        // Handle threads request (required for debug protocol)
        if (message.command === 'threads') {
            this.sendResponse({
                request_seq: message.seq,
                success: true,
                command: message.command,
                body: {
                    threads: [
                        { id: 1, name: 'main' }
                    ]
                }
            });
            return;
        }

        // Handle other required debug protocol messages
        if (message.command === 'configurationDone' ||
            message.command === 'stackTrace' ||
            message.command === 'scopes' ||
            message.command === 'variables' ||
            message.command === 'disconnect') {
            this.sendResponse({
                request_seq: message.seq,
                success: true,
                command: message.command
            });
            return;
        }

        // For unhandled requests
        this.sendResponse({
            request_seq: message.seq,
            success: false,
            command: message.command,
            message: `Unrecognized request: ${message.command}`
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
