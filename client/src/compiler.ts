import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface CompilationError {
    message: string;
    line?: number;
    column?: number;
}

export interface CompilationResult {
    success: boolean;
    exePath?: string;
    errors?: CompilationError[];
    rawOutput?: string; // Add this field to store the raw compiler output
}

/**
 * Compiles a Small Basic program using the Small Basic compiler
 * @param filePath Path to the Small Basic file
 * @param captureRawOutput Whether to capture the raw compiler output
 */
export async function compileSmallBasicProgram(filePath: string, captureRawOutput: boolean = false): Promise<CompilationResult> {
    // Get the compiler path from settings
    const config = vscode.workspace.getConfiguration('smallBasic');
    const compilerPath = config.get<string>('compilerPath') || 'C:\\Program Files (x86)\\Microsoft\\Small Basic\\SmallBasicCompiler.exe';
    
    if (!fs.existsSync(compilerPath)) {
        throw new Error(`Small Basic compiler not found at ${compilerPath}`);
    }

    // Check that the source file exists
    if (!fs.existsSync(filePath)) {
        throw new Error(`Source file not found: ${filePath}`);
    }

    // Output path will be the same as the input path but with .exe extension
    const outputFolder = path.dirname(filePath);
    const baseName = path.basename(filePath, '.sb');
    const outputExe = path.join(outputFolder, baseName + '.exe');

    try {
        // Run the Small Basic compiler
        return new Promise<CompilationResult>((resolve, reject) => {
            // Set the working directory to the folder containing the source file
            // This ensures the compiler outputs the .exe to the same location
            const process = cp.spawn(compilerPath, [filePath], {
                windowsHide: false,
                cwd: outputFolder // Set the working directory to the source file's directory
            });

            let stdOut = '';
            let stdErr = '';

            process.stdout.on('data', data => {
                stdOut += data.toString();
            });

            process.stderr.on('data', data => {
                stdErr += data.toString();
            });

            process.on('close', code => {
                // Store the raw output if requested
                const rawOutput = captureRawOutput ? stdOut + (stdErr ? '\nSTDERR:\n' + stdErr : '') : undefined;
                
                // Check for "0 errors" message which indicates success
                const zeroErrorsPattern = /(.+?):\s+0\s+errors\./i;
                const hasZeroErrors = zeroErrorsPattern.test(stdOut) || zeroErrorsPattern.test(stdErr);
                
                if (code === 0 || hasZeroErrors) {
                    // Check if the exe file was created
                    if (fs.existsSync(outputExe)) {
                        resolve({
                            success: true,
                            exePath: outputExe,
                            rawOutput
                        });
                    } else {
                        // This is unusual - successful compile but no exe? Check for actual errors
                        const errors = parseCompilerErrors(stdOut + stdErr, filePath);
                        if (errors.length > 0) {
                            resolve({
                                success: false,
                                errors,
                                rawOutput
                            });
                        } else {
                            resolve({
                                success: false,
                                errors: [{
                                    message: 'Compilation supposedly succeeded but output file not found'
                                }],
                                rawOutput
                            });
                        }
                    }
                } else {
                    // Process compiler output to find errors
                    const errors = parseCompilerErrors(stdOut + stdErr, filePath);
                    resolve({
                        success: false,
                        errors: errors.length > 0 ? errors : [{
                            message: `Compilation failed (exit code ${code}): ${stdErr || stdOut || 'Unknown error'}`
                        }],
                        rawOutput
                    });
                }
            });

            process.on('error', (err: NodeJS.ErrnoException) => {
                reject(new Error(`Failed to launch Small Basic compiler: ${err.message}`));
            });
        });

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to compile Small Basic program: ${errorMessage}`);
    }
}

/**
 * Parses the compiler output to extract error information
 */
function parseCompilerErrors(compilerOutput: string, sourcePath: string): CompilationError[] {
    const errors: CompilationError[] = [];
    
    // Check for successful compilation with "0 errors" message
    if (compilerOutput.match(/:\s+0\s+errors\./i)) {
        // This is actually a successful compilation, so return empty errors array
        return [];
    }
    
    // Split output into lines
    const lines = compilerOutput.split(/\r?\n/);
    
    // Enhanced error patterns for Small Basic compiler
    const errorPatterns = [
        // Standard error pattern with line and column
        /Error:\s+(.+?)\s+at\s+line\s+(\d+),?\s*column\s*(\d+)?/i,
        
        // Line-specific errors
        /Line\s+(\d+):\s+(.+)/i,
        
        // File with multiple errors pattern - only match if error count > 0
        /(.+?):\s+([1-9][0-9]*)\s+errors?\.$/i,
        
        // Syntax error pattern
        /Syntax\s+error(?:\s+at\s+line\s+(\d+))?:?\s+(.+)/i,
        
        // General error message pattern
        /Error:\s+(.+)/i
    ];
    
    // Track if we need to look for detailed errors after summary line
    let lookForDetailedErrors = false;
    
    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (!trimmedLine) continue;
        
        // Skip lines about 0 errors
        if (trimmedLine.match(/:\s+0\s+errors\./i)) {
            continue;
        }
        
        // Check if this is a summary line like "file.sb: N errors."
        const summaryMatch = trimmedLine.match(/(.+?):\s+([1-9][0-9]*)\s+errors?\.$/i);
        if (summaryMatch) {
            // If we have a summary line with error count > 0, look for detailed errors
            lookForDetailedErrors = true;
            
            // Add a placeholder for the summary
            errors.push({
                message: `The program has ${summaryMatch[2]} errors. See detailed messages below.`
            });
            continue;
        }
        
        // Rest of the error processing logic
        // ...existing code...
        
        // If we're looking for detailed errors after a summary
        if (lookForDetailedErrors) {
            // Look for patterns like "Line X: Error message" in the following lines
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                const errorLineMatch = nextLine.match(/Line\s+(\d+)(?:,\s*Col\s+(\d+))?:\s+(.+)/i);
                if (errorLineMatch) {
                    errors.push({
                        message: errorLineMatch[3],
                        line: parseInt(errorLineMatch[1], 10),
                        column: errorLineMatch[2] ? parseInt(errorLineMatch[2], 10) : undefined
                    });
                    i++; // Skip the next line since we've processed it
                    continue;
                }
            }
        }
        
        let matched = false;
        
        // Try all patterns
        for (const pattern of errorPatterns) {
            const match = trimmedLine.match(pattern);
            if (match) {
                matched = true;
                
                if (pattern.source.includes('at\\s+line\\s+')) {
                    // Pattern: "Error: [message] at line [line], column [column]"
                    const message = match[1];
                    const lineNum = parseInt(match[2], 10);
                    const column = match[3] ? parseInt(match[3], 10) : undefined;
                    
                    errors.push({
                        message,
                        line: lineNum,
                        column
                    });
                } 
                else if (pattern.source.includes('Line\\s+')) {
                    // Pattern: "Line [line]: [message]"
                    const lineNum = parseInt(match[1], 10);
                    const message = match[2];
                    
                    errors.push({
                        message,
                        line: lineNum
                    });
                }
                else if (pattern.source.includes('Syntax')) {
                    // Syntax error with possible line number
                    const lineNum = match[1] ? parseInt(match[1], 10) : undefined;
                    const message = `Syntax error: ${match[2] || 'Invalid syntax'}`;
                    
                    errors.push({
                        message,
                        line: lineNum
                    });
                }
                else if (pattern.source.includes('([1-9][0-9]*)\\s+errors?')) {
                    // This is a summary line, just noting multiple errors
                    const errorCount = parseInt(match[2], 10);
                    if (errorCount > 0) {
                        errors.push({
                            message: `File contains ${errorCount} errors`
                        });
                    }
                }
                else {
                    // General error message
                    errors.push({
                        message: match[1]
                    });
                }
                
                break; // Once we found a match, stop checking patterns
            }
        }
        
        // If no pattern matched but line contains 'error', add it as a generic error
        if (!matched && trimmedLine.toLowerCase().includes('error') && 
            !trimmedLine.match(/0\s+errors/i)) {  // Exclude mentions of "0 errors"
            errors.push({
                message: trimmedLine
            });
        }
    }
    
    // If we have a source file path and errors without line numbers,
    // try to augment them by examining the file content
    if (errors.length > 0 && fs.existsSync(sourcePath)) {
        // ...existing code...
        try {
            const fileContent = fs.readFileSync(sourcePath, 'utf8');
            const sourceLines = fileContent.split(/\r?\n/);
            
            // For errors without line numbers, try to find common issues in the code
            for (let i = 0; i < errors.length; i++) {
                if (errors[i].line === undefined) {
                    // Try to find common syntax issues
                    for (let lineNum = 0; lineNum < sourceLines.length; lineNum++) {
                        const line = sourceLines[lineNum].trim();
                        
                        // Missing EndIf
                        if (line.toLowerCase().startsWith('if') && !line.toLowerCase().includes('then')) {
                            errors.push({
                                message: 'If statement missing "Then" keyword',
                                line: lineNum + 1
                            });
                        }
                        
                        // Unclosed strings
                        const quoteCount = (line.match(/"/g) || []).length;
                        if (quoteCount % 2 !== 0 && !line.startsWith("'")) {
                            errors.push({
                                message: 'Unclosed string (uneven number of quotes)',
                                line: lineNum + 1
                            });
                        }
                    }
                }
            }
        } catch (err) {
            // Silently fail if we can't read the source file
            console.error('Error reading source file for error augmentation:', err);
        }
    }
    
    return errors;
}
