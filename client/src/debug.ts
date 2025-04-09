import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';

/**
 * Handles running Small Basic files
 */
export async function handleSmallBasicDebug(uri: vscode.Uri | string, options: { 
    compileOnly?: boolean,
    outputChannel?: vscode.OutputChannel
} = {}): Promise<boolean> {
    try {
        // Get the file path from URI or string
        const filePath = typeof uri === 'string' ? uri : uri.fsPath;
        
        // Create or reuse output channel
        const outputChannel = options.outputChannel || vscode.window.createOutputChannel('Small Basic Debug');
        if (!options.outputChannel) {
            outputChannel.show(true);
            outputChannel.clear();
        }
        
        outputChannel.appendLine(`Compiling: ${filePath}`);
        
        // Get the compiler path
        const compilerPath = getCompilerPath();
        
        // Check that file exists
        if (!fs.existsSync(filePath)) {
            outputChannel.appendLine(`ERROR: File not found: ${filePath}`);
            return false;
        }
        
        // Check that compiler exists
        if (!fs.existsSync(compilerPath)) {
            outputChannel.appendLine(`ERROR: Small Basic compiler not found at: ${compilerPath}`);
            outputChannel.appendLine("Please install Small Basic or update the path in settings.");
            return false;
        }
        
        // Calculate output EXE path
        const outputFolder = path.dirname(filePath);
        const baseName = path.basename(filePath, '.sb');
        const outputExe = path.join(outputFolder, baseName + '.exe');
        
        // Run the compiler as a synchronous process
        outputChannel.appendLine('Running Small Basic compiler...');
        
        try {
            // Execute the compiler
            const compileOutput = cp.execSync(`"${compilerPath}" "${filePath}"`, {
                cwd: outputFolder,
                encoding: 'utf8'
            });
            
            outputChannel.appendLine(compileOutput || 'Compilation completed');
            
            // Check if the executable was created
            if (fs.existsSync(outputExe)) {
                outputChannel.appendLine('✅ Compilation successful!');
                
                if (!options.compileOnly) {
                    outputChannel.appendLine(`⚡ Running: ${outputExe}`);
                    
                    // Launch the program using start command
                    cp.exec(`start "" "${outputExe}"`, {
                        cwd: outputFolder,
                        windowsHide: false
                    });
                    
                    outputChannel.appendLine('Program launched successfully');
                } else {
                    outputChannel.appendLine('Compile-only mode - program not started');
                }
                
                return true;
            } else {
                outputChannel.appendLine('❌ Compiled executable not found');
                return false;
            }
        } catch (error: any) {
            // If compilation failed
            const errorMsg = error instanceof Error ? error.message : String(error);
            const stdErr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
            
            outputChannel.appendLine(`❌ Compilation failed: ${errorMsg}`);
            if (stdErr) {
                outputChannel.appendLine(`Error details: ${stdErr}`);
            }
            return false;
        }
    } catch (error) {
        console.error('Error in Small Basic Debug:', error);
        return false;
    }
}

/**
 * Gets the path to the Small Basic compiler
 */
function getCompilerPath(): string {
    // First check user settings
    try {
        const config = vscode.workspace.getConfiguration('smallBasic');
        const configPath = config.get<string>('compilerPath');
        
        if (configPath && fs.existsSync(configPath)) {
            return configPath;
        }
    } catch (e) {
        // Ignore errors reading config
    }
    
    // Fall back to default installation location
    return 'C:\\Program Files (x86)\\Microsoft\\Small Basic\\SmallBasicCompiler.exe';
}

// Handle command line execution for testing
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: node debug.js <file.sb> [--compile-only]');
        process.exit(1);
    }
    
    const filePath = args[0];
    const compileOnly = args.includes('--compile-only');
    
    // Create a basic output channel that outputs to console
    const consoleOutputChannel = {
        appendLine: (line: string) => {
            console.log(line);
        },
        clear: () => {},
        show: () => {},
        dispose: () => {}
    };
    
    // Call the main function
    handleSmallBasicDebug(filePath, {
        compileOnly,
        outputChannel: consoleOutputChannel as any
    })
    .then(success => {
        if (!success) {
            process.exit(1);
        }
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
}
