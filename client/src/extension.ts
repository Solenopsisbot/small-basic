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

	// Register the debug functionality - CLEAN VERSION WITHOUT DUPLICATES
	// 1. Register configuration provider (for launch.json configurations)
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('smallbasic', new SmallBasicDebugConfigurationProvider())
	);

	// 2. Register the debug adapter descriptor factory (only once!)
	context.subscriptions.push(
		debug.registerDebugAdapterDescriptorFactory('smallbasic', new SmallBasicDebugAdapterDescriptorFactory())
	);

	// 3. Register configuration snippets provider
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('smallbasic', {
			provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): vscode.ProviderResult<vscode.DebugConfiguration[]> {
				return [
					{
						type: 'smallbasic',
						request: 'launch',
						name: 'Run Small Basic Program',
						program: '${file}',
						compileOnly: false
					},
					{
						type: 'smallbasic',
						request: 'launch',
						name: 'Compile Small Basic Program',
						program: '${file}',
						compileOnly: true
					}
				];
			}
		})
	);

	// 4. Register F5 handler for Small Basic files
	context.subscriptions.push(
		commands.registerCommand('smallbasic.debug', (resource?: vscode.Uri) => {
			handleSmallBasicDebug(resource);
		})
	);

	// 5. Register automatic F5 handler for .sb files (catch all debug sessions)
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('*', {
			resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.ProviderResult<vscode.DebugConfiguration> {
				const editor = vscode.window.activeTextEditor;
				
				// Check if this is an F5 press in a Small Basic file
				if (editor && editor.document.languageId === 'smallbasic') {
					if (!config.type || !config.request) {
						// This is a direct F5 without specific configuration
						// Directly handle Small Basic files instead of showing a popup
						handleSmallBasicDebug(editor.document.uri);
						// Return undefined to prevent VS Code from trying to start a debug session
						return undefined;
					}
					
					// If smallbasic is specified as the debug type, handle it
					if (config.type === 'smallbasic') {
						const uri = vscode.Uri.file(config.program as string);
						handleSmallBasicDebug(uri);
						return undefined;
					}
				}
				
				return config; // Return the config unchanged for other file types
			}
		}, vscode.DebugConfigurationProviderTriggerKind.Dynamic)
	);

	// 6. Custom debug event handler
	context.subscriptions.push(
		debug.onDidReceiveDebugSessionCustomEvent((event: vscode.DebugSessionCustomEvent) => {
			if (event.event === 'smallbasic:run' && event.body?.uri) {
				const uri = vscode.Uri.parse(event.body.uri);
				handleSmallBasicDebug(uri);
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
