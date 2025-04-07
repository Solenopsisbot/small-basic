import * as vscode from 'vscode';
import { compileSmallBasicProgram } from './compiler';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

/**
 * Handles direct debug commands (F5) for Small Basic files
 */
export async function handleSmallBasicDebug(uri?: vscode.Uri): Promise<void> {
    // If no URI is provided, use the active editor
    if (!uri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'smallbasic') {
            vscode.window.showErrorMessage('No Small Basic file is active');
            return;
        }
        uri = activeEditor.document.uri;
    }
    
    // Get the file path
    const filePath = uri.fsPath;
    
    // Ensure the file has been saved
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) {
        await document.save();
    }
    
    // Create an output channel for displaying compilation results
    const outputChannel = vscode.window.createOutputChannel('Small Basic Debug');
    outputChannel.show(true);
    
    try {
        // Show a progress notification during compilation
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Compiling Small Basic program..."
        }, async () => {
            // Write to output channel
            outputChannel.appendLine(`Compiling: ${filePath}`);
            outputChannel.appendLine('------------------------------------------------------------');
            
            // Compile the program
            const result = await compileSmallBasicProgram(filePath, true); // Pass true to get raw output
            
            // Display raw compiler output if available
            if (result.rawOutput) {
                outputChannel.appendLine('COMPILER OUTPUT:');
                outputChannel.appendLine('------------------------------------------------------------');
                outputChannel.appendLine(result.rawOutput);
                outputChannel.appendLine('------------------------------------------------------------');
            }
            
            if (result.success) {
                outputChannel.appendLine(`✅ Compilation successful: ${path.basename(filePath)}`);
                
                // Run the compiled program
                if (result.exePath && fs.existsSync(result.exePath)) {
                    outputChannel.appendLine(`⚡ Running program: ${path.basename(result.exePath)}`);
                    
                    try {
                        // Use the Windows 'start' command to launch the program as if double-clicked
                        const exePath = result.exePath; // Store in variable to satisfy TypeScript
                        const cwd = path.dirname(exePath);
                        
                        cp.exec(`start "" "${exePath}"`, {
                            cwd: cwd,
                            windowsHide: false
                        }, (error) => {
                            if (error) {
                                outputChannel.appendLine(`Error launching program: ${error.message}`);
                                vscode.window.showErrorMessage(`Failed to launch program: ${error.message}`);
                            }
                        });
                        
                        outputChannel.appendLine(`Program launched successfully`);
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        outputChannel.appendLine(`Error launching program: ${errorMessage}`);
                        vscode.window.showErrorMessage(`Error launching Small Basic program: ${errorMessage}`);
                    }
                } else {
                    const errorMsg = 'Compilation succeeded but output file not found';
                    outputChannel.appendLine(`ERROR: ${errorMsg}`);
                    vscode.window.showErrorMessage(errorMsg);
                }
            } else if (result.errors && result.errors.length > 0) {
                // Show detailed compilation errors in output channel
                outputChannel.appendLine(`❌ Compilation failed with ${result.errors.length} errors:`);
                outputChannel.appendLine('------------------------------------------------------------');
                
                // Load the source file to display the error lines
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    
                    for (const error of result.errors) {
                        if (error.line !== undefined) {
                            const lineNumber = error.line;
                            const line = document.lineAt(Math.max(0, lineNumber - 1)).text.trimRight();
                            
                            outputChannel.appendLine(`[Line ${lineNumber}]${error.column ? `, Col ${error.column}` : ''}:`);
                            outputChannel.appendLine(`  ${line}`);
                            
                            // Add indicator for column position if available
                            if (error.column !== undefined) {
                                const padding = ' '.repeat(error.column + 1);
                                outputChannel.appendLine(`  ${padding}^`);
                            }
                            
                            outputChannel.appendLine(`  Error: ${error.message}`);
                        } else {
                            outputChannel.appendLine(`Error: ${error.message}`);
                        }
                        outputChannel.appendLine('');
                    }
                    
                    // Create diagnostics for errors
                    const diagnostics: vscode.Diagnostic[] = result.errors.map(error => {
                        let range: vscode.Range;
                        
                        if (error.line !== undefined) {
                            const line = Math.max(0, error.line - 1);
                            const column = error.column !== undefined ? Math.max(0, error.column - 1) : 0;
                            const lineText = document.lineAt(line).text;
                            const endColumn = column + (lineText.substr(column).match(/\b\w+\b/) || [''])[0].length || 10;
                            
                            range = new vscode.Range(line, column, line, endColumn);
                        } else {
                            range = new vscode.Range(0, 0, 0, 5);
                        }
                        
                        return new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
                    });
                    
                    // Set diagnostics for the file
                    const diagnosticCollection = vscode.languages.createDiagnosticCollection('smallBasicCompiler');
                    diagnosticCollection.set(uri, diagnostics);
                    
                } catch (err) {
                    // If we can't load the source file, just show the errors without context
                    for (const error of result.errors) {
                        if (error.line !== undefined) {
                            outputChannel.appendLine(`Error at line ${error.line}${error.column ? `, column ${error.column}` : ''}: ${error.message}`);
                        } else {
                            outputChannel.appendLine(`Error: ${error.message}`);
                        }
                    }
                }
                
                // Show a brief notification
                vscode.window.showErrorMessage(`Compilation failed with ${result.errors.length} errors. See Output panel for details.`);
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`ERROR: ${errorMessage}`);
        vscode.window.showErrorMessage(`Error during Small Basic debugging: ${errorMessage}`);
    }
}

// Add entry point for command line usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const filePath = args[0];
    const compileOnly = args.includes('--compile-only');
    
    if (!filePath) {
        console.error('No file path provided');
        process.exit(1);
    }
    
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    
    (async () => {
        try {
            const result = await compileSmallBasicProgram(filePath);
            
            if (result.success) {
                console.log(`Successfully compiled ${path.basename(filePath)}`);
                
                if (!compileOnly && result.exePath) {
                    console.log(`Running ${path.basename(result.exePath)}...`);
                    // Use the Windows-specific start command for best results
                    const exePath = result.exePath;
                    cp.exec(`start "" "${exePath}"`, {
                        cwd: path.dirname(exePath)
                    });
                }
            } else {
                console.error('Compilation failed:');
                if (result.errors) {
                    result.errors.forEach(err => {
                        console.error(`  ${err.message}`);
                    });
                }
                process.exit(1);
            }
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    })();
}
