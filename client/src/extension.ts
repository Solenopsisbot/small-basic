/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import * as vscode from 'vscode';
import { workspace, ExtensionContext, window, debug, commands, languages, Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode';
import { handleSmallBasicDebug } from './debug';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { SmallBasicDebugConfigurationProvider, SmallBasicDebugAdapterDescriptorFactory } from './debugAdapter';
import { compileSmallBasicProgram } from './compiler';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for Small Basic documents
		documentSelector: [{ scheme: 'file', language: 'smallbasic' }],
		synchronize: {
			// Notify the server about file changes to config files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.smallbasicrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'smallBasicLanguageServer',
		'Small Basic Language Server',
		serverOptions,
		clientOptions
	);

	// Register a diagnostic collection for compiler errors
	const diagnosticCollection = languages.createDiagnosticCollection('smallBasicCompiler');
	context.subscriptions.push(diagnosticCollection);

	// Register compile and run commands
	context.subscriptions.push(
		commands.registerCommand('smallbasic.compile', async () => {
			const activeEditor = window.activeTextEditor;
			if (!activeEditor || activeEditor.document.languageId !== 'smallbasic') {
				window.showErrorMessage('No Small Basic file is active');
				return;
			}

			// Make sure the file is saved
			if (activeEditor.document.isDirty) {
				await activeEditor.document.save();
			}

			try {
				// Clear previous diagnostics
				diagnosticCollection.clear();
				
				const filePath = activeEditor.document.uri.fsPath;
				const result = await compileSmallBasicProgram(filePath);
				
				if (result.success) {
					window.showInformationMessage('Small Basic program compiled successfully');
				} else if (result.errors && result.errors.length > 0) {
					// Display errors in Problems panel
					window.showErrorMessage('Compilation failed with errors');
					
					const diagnostics: Diagnostic[] = result.errors.map(error => {
						let range: Range;
						
						if (error.line !== undefined && error.column !== undefined) {
							const line = Math.max(0, error.line - 1);
							const column = Math.max(0, error.column - 1);
							range = new Range(new Position(line, column), new Position(line, column + 10));
						} else {
							range = new Range(new Position(0, 0), new Position(0, 10));
						}
						
						return new Diagnostic(range, error.message, DiagnosticSeverity.Error);
					});
					
					diagnosticCollection.set(activeEditor.document.uri, diagnostics);
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				window.showErrorMessage(`Error during compilation: ${errorMessage}`);
			}
		}),
		
		commands.registerCommand('smallbasic.run', async () => {
			const activeEditor = window.activeTextEditor;
			if (!activeEditor || activeEditor.document.languageId !== 'smallbasic') {
				window.showErrorMessage('No Small Basic file is active');
				return;
			}

			// Make sure the file is saved
			if (activeEditor.document.isDirty) {
				await activeEditor.document.save();
			}

			// Start a debug session with the appropriate configuration
			await debug.startDebugging(undefined, {
				type: 'smallbasic',
				request: 'launch',
				name: 'Run Small Basic Program',
				program: activeEditor.document.uri.fsPath,
				compileOnly: false
			});
		})
	);

	// VERY SIMPLE DEBUG IMPLEMENTATION - Direct execution approach
	// Skip all the debug adapter complexity and just compile and run directly
	context.subscriptions.push(
		commands.registerCommand('extension.smallbasic.debug', async () => {
			// Get the active text editor
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'smallbasic') {
				vscode.window.showErrorMessage('No Small Basic file is active');
				return;
			}

			// Make sure the file is saved
			if (editor.document.isDirty) {
				await editor.document.save();
			}

			// Create an output channel
			const outputChannel = vscode.window.createOutputChannel('Small Basic Debug');
			outputChannel.clear();
			outputChannel.show(true);
			
			outputChannel.appendLine(`Running: ${editor.document.uri.fsPath}`);
			
			// Directly execute the Small Basic file
			try {
				const success = await handleSmallBasicDebug(editor.document.uri, {
					outputChannel
				});
				
				if (!success) {
					vscode.window.showErrorMessage('Failed to run Small Basic program');
				}
			} catch (error) {
				outputChannel.appendLine(`ERROR: ${error}`);
				vscode.window.showErrorMessage(`Error: ${error}`);
			}
		})
	);

	// Register F5 keyboard shortcut to run our command
	context.subscriptions.push(
		vscode.commands.registerCommand('smallbasic.runAndDebug', () => {
			vscode.commands.executeCommand('extension.smallbasic.debug');
		})
	);

	// Register a keybinding for F5
	vscode.commands.executeCommand('setContext', 'smallbasic.enabled', true);
	
	// Register the "Run and Debug" button command
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('smallbasic', {
			provideDebugConfigurations() {
				return [
					{
						type: 'smallbasic',
						request: 'launch',
						name: 'Run Small Basic Program',
						program: '${file}'
					}
				];
			},
			
			resolveDebugConfiguration(_folder, _config) {
				// Instead of returning a debug configuration, directly execute our command
				vscode.commands.executeCommand('extension.smallbasic.debug');
				// Return undefined to prevent the debug session from continuing with VS Code's debug adapter
				return undefined;
			}
		})
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
