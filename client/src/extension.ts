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
	// Set extensions.ignoreRecommendations to true in user settings
	setIgnoreRecommendations();

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

	// ========== DEBUG CONFIGURATION - CLEAN IMPLEMENTATION ==========

	// 1. IMPORTANT: Register the debug adapter descriptor factory (ONCE ONLY)
	context.subscriptions.push(
		debug.registerDebugAdapterDescriptorFactory('smallbasic', new SmallBasicDebugAdapterDescriptorFactory())
	);

	// 2. Register the debug configuration provider for F5 and launch configurations
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('smallbasic', {
			// Provide default configurations for launch.json
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
			},
			
				// Handle F5 with no configuration
			resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
				// If no configuration is provided (pressed F5 with no launch.json)
				if (!config.type || !config.request) {
					const editor = vscode.window.activeTextEditor;
					if (editor && editor.document.languageId === 'smallbasic') {
						// Create a basic configuration
						return {
							type: 'smallbasic',
							request: 'launch',
							name: 'Debug Small Basic',
							program: editor.document.uri.fsPath,
							compileOnly: false
							};
						}
					}
					
					// If this is a smallbasic config, ensure it has the required properties
					if (config.type === 'smallbasic') {
						// If program is missing or invalid, use the active editor
						if (!config.program) {
							const editor = vscode.window.activeTextEditor;
							if (editor && editor.document.languageId === 'smallbasic') {
								config.program = editor.document.uri.fsPath;
							} else {
								window.showErrorMessage('No Small Basic file active to debug');
								return undefined; // Cancel debug session
							}
						}
						
						// Set defaults for other properties if missing
						config.request = config.request || 'launch';
						config.compileOnly = config.compileOnly || false;
					}
					
					return config;
				}
			}, vscode.DebugConfigurationProviderTriggerKind.Dynamic)
		);

	// 3. Register a catch-all debug configuration provider to handle F5 on Small Basic files
	//    even when another debug type is active
	context.subscriptions.push(
		debug.registerDebugConfigurationProvider('*', {
			resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.ProviderResult<vscode.DebugConfiguration> {
					// Check if this is an F5 press with no config and we're in a Small Basic file
					if (!config.type && !config.request) {
						const editor = vscode.window.activeTextEditor;
						if (editor && editor.document.languageId === 'smallbasic') {
							// Direct handling via our custom handler
							handleSmallBasicDebug(editor.document.uri);
							return undefined; // Cancel default VS Code debug session
						}
					}
					// Let other debug types proceed normally
					return config;
				}
			}, vscode.DebugConfigurationProviderTriggerKind.Dynamic)
		);

	// 4. Register F5 command handler
	context.subscriptions.push(
		commands.registerCommand('smallbasic.debug', (resource?: vscode.Uri) => {
			handleSmallBasicDebug(resource);
		})
	);

	// Start the client. This will also launch the server
	client.start();
}

/**
 * Sets the "extensions.ignoreRecommendations" setting to true in user settings
 */
async function setIgnoreRecommendations(): Promise<void> {
	try {
		const config = vscode.workspace.getConfiguration();
		const currentValue = config.get('extensions.ignoreRecommendations');
		
		// Only set if it's not already true
		if (currentValue !== true) {
			await config.update('extensions.ignoreRecommendations', true, vscode.ConfigurationTarget.Global);
			console.log('Set extensions.ignoreRecommendations to true');
		}
	} catch (err) {
		// Log error but don't disturb the user
		console.error('Error setting extensions.ignoreRecommendations:', err);
	}
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
