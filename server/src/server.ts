/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	DocumentSymbol,
	DocumentSymbolParams,
	SymbolKind,
	Range,
	CompletionItemTag
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

// Load Small Basic objects and keywords from JSON file
interface SmallBasicMember {
	name: string;
	type: string;
	description: string;
}

interface SmallBasicObject {
	name: string;
	description: string;
	properties: string[];
	methods: string[];
}

interface SmallBasicData {
	keywords: string[];
	objects: SmallBasicObject[];
}

// Default data in case the file can't be loaded
let smallBasicData: SmallBasicData = {
	keywords: [
		'If', 'Then', 'Else', 'ElseIf', 'EndIf', 'While', 'EndWhile', 
		'For', 'To', 'Step', 'EndFor', 'Sub', 'EndSub', 'Goto', 'And', 'Or', 'Not'
	],
	objects: []
};

// Try to load the SmallBasic objects data file
try {
	const dataPath = path.join(__dirname, '..', '..', 'data', 'smallbasic-objects.json');
	const fileContent = fs.readFileSync(dataPath, 'utf8');
	smallBasicData = JSON.parse(fileContent) as SmallBasicData;
	connection.console.log(`Loaded SmallBasic objects data from ${dataPath}`);
} catch (err) {
	connection.console.error(`Error loading SmallBasic objects data: ${err}`);
}

// Convenience variables
const smallBasicKeywords = smallBasicData.keywords;
const smallBasicObjects = smallBasicData.objects;

// Store variables and subroutines from documents
const documentVariables = new Map<string, Map<string, { name: string, type: string }>>();
const documentSubs = new Map<string, Map<string, { name: string, range: Range }>>();

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.'] // Trigger completion when typing a dot
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			documentSymbolProvider: true // Add document symbol provider capability
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface SmallBasicSettings {
	maxNumberOfProblems: number;
	enableAutoParentheses: boolean;
}

// The global settings
const defaultSettings: SmallBasicSettings = { 
	maxNumberOfProblems: 1000,
	enableAutoParentheses: true
};
let globalSettings: SmallBasicSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<SmallBasicSettings>>();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = (
			(change.settings.smallBasic || defaultSettings)
		);
	}
	// Refresh the diagnostics
	connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<SmallBasicSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'smallBasic'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});


connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: await validateTextDocument(document)
		} satisfies DocumentDiagnosticReport;
	} else {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies DocumentDiagnosticReport;
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
	// Parse the document to find variables and subroutines
	parseDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
	// In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);

	const text = textDocument.getText();
	const lines = text.split(/\r?\n/);
	const diagnostics: Diagnostic[] = [];
	
	// Track each control structure individually with its line number
	interface ControlStatement {
		keyword: string;
		line: number;
		column: number;
		matched: boolean;
	}
	
	const ifStatements: ControlStatement[] = [];
	const whileStatements: ControlStatement[] = [];
	const forStatements: ControlStatement[] = [];
	const subStatements: ControlStatement[] = [];
	const endIfLines: number[] = [];
	const endWhileLines: number[] = [];
	const endForLines: number[] = [];
	const endSubLines: number[] = [];
	
	// Find all control structures and their positions
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		
		// Check for If statements
		const ifMatch = /^If\b/i.exec(line);
		if (ifMatch) {
			ifStatements.push({ 
				keyword: 'If', 
				line: i, 
				column: lines[i].indexOf('If'),
				matched: false
			});
		}
		
		// Check for While statements
		const whileMatch = /^While\b/i.exec(line);
		if (whileMatch) {
			whileStatements.push({
				keyword: 'While',
				line: i,
				column: lines[i].indexOf('While'),
				matched: false
			});
		}
		
		// Check for For statements
		const forMatch = /^For\b/i.exec(line);
		if (forMatch) {
			forStatements.push({
				keyword: 'For',
				line: i,
				column: lines[i].indexOf('For'),
				matched: false
			});
		}
		
		// Check for Sub statements
		const subMatch = /^Sub\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(line);
		if (subMatch) {
			subStatements.push({
				keyword: 'Sub ' + subMatch[1],
				line: i,
				column: lines[i].indexOf('Sub'),
				matched: false
			});
		}
		
		// Record positions of end statements
		if (/^EndIf\b/i.test(line)) endIfLines.push(i);
		if (/^EndWhile\b/i.test(line)) endWhileLines.push(i);
		if (/^EndFor\b/i.test(line)) endForLines.push(i);
		if (/^EndSub\b/i.test(line)) endSubLines.push(i);
	}
	
	// Match end statements with their corresponding start statements
	// (This is a simplified approach that doesn't handle nested blocks perfectly)
	
	// Match EndIfs
	for (const endLine of endIfLines) {
		for (let i = ifStatements.length - 1; i >= 0; i--) {
			if (!ifStatements[i].matched && ifStatements[i].line < endLine) {
				ifStatements[i].matched = true;
				break;
			}
		}
	}
	
	// Match EndWhiles
	for (const endLine of endWhileLines) {
		for (let i = whileStatements.length - 1; i >= 0; i--) {
			if (!whileStatements[i].matched && whileStatements[i].line < endLine) {
				whileStatements[i].matched = true;
				break;
			}
		}
	}
	
	// Match EndFors
	for (const endLine of endForLines) {
		for (let i = forStatements.length - 1; i >= 0; i--) {
			if (!forStatements[i].matched && forStatements[i].line < endLine) {
				forStatements[i].matched = true;
				break;
			}
		}
	}
	
	// Match EndSubs
	for (const endLine of endSubLines) {
		for (let i = subStatements.length - 1; i >= 0; i--) {
			if (!subStatements[i].matched && subStatements[i].line < endLine) {
				subStatements[i].matched = true;
				break;
			}
		}
	}
	
	// Create diagnostics for unmatched control structures
	for (const ifStmt of ifStatements) {
		if (!ifStmt.matched) {
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: ifStmt.line, character: ifStmt.column },
					end: { line: ifStmt.line, character: ifStmt.column + 2 }
				},
				message: 'Missing EndIf for this If statement',
				source: 'Small Basic'
			});
		}
	}
	
	for (const whileStmt of whileStatements) {
		if (!whileStmt.matched) {
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: whileStmt.line, character: whileStmt.column },
					end: { line: whileStmt.line, character: whileStmt.column + 5 }
				},
				message: 'Missing EndWhile for this While statement',
				source: 'Small Basic'
			});
		}
	}
	
	for (const forStmt of forStatements) {
		if (!forStmt.matched) {
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: forStmt.line, character: forStmt.column },
					end: { line: forStmt.line, character: forStmt.column + 3 }
				},
				message: 'Missing EndFor for this For statement',
				source: 'Small Basic'
			});
		}
	}
	
	for (const subStmt of subStatements) {
		if (!subStmt.matched) {
			// Get the line's text to calculate the end position
			const lineText = lines[subStmt.line];
			const subNameLength = subStmt.keyword.length;
			
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: subStmt.line, character: subStmt.column },
					end: { line: subStmt.line, character: subStmt.column + subNameLength }
				},
				message: `Missing EndSub for subroutine '${subStmt.keyword.substring(4)}'`,
				source: 'Small Basic'
			});
		}
	}

	return diagnostics;
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have changed in VSCode
	connection.console.log('We received a file change event');
});

// Parse document to find variables and subroutines
function parseDocument(document: TextDocument): void {
	const text = document.getText();
	const lines = text.split(/\r?\n/);
	const uri = document.uri;
	
	// Clear existing variables and subs
	const variables = new Map<string, { name: string, type: string }>();
	const subs = new Map<string, { name: string, range: Range }>();
	
	// Find variables (simple assignment detection)
	const variableAssignmentRegex = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/;
	
	// Find subs
	const subStartRegex = /^\s*Sub\s+([A-Za-z][A-Za-z0-9_]*)\s*$/i;
	const subEndRegex = /^\s*EndSub\s*$/i;
	
	let currentSub: { name: string, startLine: number } | null = null;
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		
		// Check for variable assignments
		const varMatch = line.match(variableAssignmentRegex);
		if (varMatch) {
			const varName = varMatch[1];
			const varValue = varMatch[2].trim();
			let varType = 'variable';
			
			// Try to determine type based on value
			if (varValue.startsWith('"') && varValue.endsWith('"')) {
				varType = 'string';
			} else if (!isNaN(Number(varValue))) {
				varType = 'number';
			} else if (varValue.toLowerCase() === 'true' || varValue.toLowerCase() === 'false') {
				varType = 'boolean';
			}
			
			variables.set(varName.toLowerCase(), { name: varName, type: varType });
		}
		
		// Check for subroutine definitions
		const subStartMatch = line.match(subStartRegex);
		if (subStartMatch) {
			const subName = subStartMatch[1];
			currentSub = { name: subName, startLine: i };
		}
		
		// Check for end of subroutine
		const subEndMatch = line.match(subEndRegex);
		if (subEndMatch && currentSub) {
			subs.set(currentSub.name.toLowerCase(), {
				name: currentSub.name,
				range: {
					start: { line: currentSub.startLine, character: 0 },
					end: { line: i, character: line.length }
				}
			});
			currentSub = null;
		}
	}
	
	documentVariables.set(uri, variables);
	documentSubs.set(uri, subs);
}

// Document symbol provider
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return [];
	}
	
	// Make sure we have parsed the document
	parseDocument(document);
	
	const symbols: DocumentSymbol[] = [];
	
	// Add subroutines
	const subs = documentSubs.get(params.textDocument.uri);
	if (subs) {
		subs.forEach(sub => {
			symbols.push({
				name: sub.name,
				detail: 'Subroutine',
				kind: SymbolKind.Method,
				range: sub.range,
				selectionRange: {
					start: sub.range.start,
					end: { line: sub.range.start.line, character: sub.range.start.character + 3 + sub.name.length }
				},
				children: []
			});
		});
	}
	
	// Add variables
	const vars = documentVariables.get(params.textDocument.uri);
	if (vars) {
		vars.forEach(variable => {
			// Look for the variable in the document to get its range
			// This is a simplification - a proper implementation would track exact positions
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const text = document.getText();
				const varPattern = new RegExp(`\\b${variable.name}\\b\\s*=`, 'i');
				const match = varPattern.exec(text);
				if (match) {
					const pos = document.positionAt(match.index);
					symbols.push({
						name: variable.name,
						detail: `Variable (${variable.type})`,
						kind: SymbolKind.Variable,
						range: {
							start: pos,
							end: { line: pos.line, character: pos.character + variable.name.length }
						},
						selectionRange: {
							start: pos,
							end: { line: pos.line, character: pos.character + variable.name.length }
						},
						children: []
					});
				}
			}
		});
	}
	
	return symbols;
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (!document) {
			return [];
		}

		// Get settings
		const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
		const enableAutoParentheses = settings.enableAutoParentheses;

		const text = document.getText();
		const position = textDocumentPosition.position;
		const offset = document.offsetAt(position);
		
		// Check if we're after a dot
		const currentLine = text.split('\n')[position.line];
		const linePrefix = currentLine.substring(0, position.character);
		
		// Object property completion (after a dot)
		if (linePrefix.endsWith('.')) {
			// Find which object the dot belongs to
			const objectName = linePrefix.substring(0, linePrefix.length - 1).trim();
			const object = smallBasicObjects.find(obj => obj.name.toLowerCase() === objectName.toLowerCase());
			
			if (object) {
				const completions: CompletionItem[] = [];
				
				// Add properties
				if (object.properties) {
					object.properties.forEach(property => {
						completions.push({
							label: property,
							kind: CompletionItemKind.Property,
							data: { 
								type: 'member', 
								objectName: object.name, 
								memberName: property,
								isMethod: false
							}
						});
					});
				}
				
				// Add methods
				if (object.methods) {
					object.methods.forEach(method => {
						const item: CompletionItem = {
							label: method,
							kind: CompletionItemKind.Method,
							data: { 
								type: 'member', 
								objectName: object.name, 
								memberName: method,
								isMethod: true
							}
						};
						
						// Add parentheses to method calls if enabled
						if (enableAutoParentheses) {
							item.insertText = method + '()';
							item.command = {
								title: 'Cursor between parentheses',
								command: 'editor.action.triggerParameterHints'
							};
						}
						
						completions.push(item);
					});
				}
				
				return completions;
			}
			
			return [];
		}

		// Regular keyword and object completion
		const completions: CompletionItem[] = [];
		
		// Add keywords with highest priority
		smallBasicKeywords.forEach((keyword, index) => {
			completions.push({
				label: keyword,
				kind: CompletionItemKind.Keyword,
				data: { type: 'keyword', index },
				sortText: '1' + keyword // Ensures keywords come first with simple numeric sorting
			});
		});
		
		// Add objects with second highest priority - right after keywords
		smallBasicObjects.forEach((object, index) => {
			completions.push({
				label: object.name,
				kind: CompletionItemKind.Class,
				data: { type: 'object', index },
				sortText: '2' + object.name, // Ensures classes always come after keywords
				preselect: true  // Add preselect to make classes preferentially selected
			});
		});
		
		// Add variables with third priority
		const variables = documentVariables.get(textDocumentPosition.textDocument.uri);
		if (variables) {
			variables.forEach(variable => {
				completions.push({
					label: variable.name,
					kind: CompletionItemKind.Variable,
					detail: `(${variable.type})`,
					data: { type: 'variable', name: variable.name },
					sortText: '3' + variable.name // Ensures variables always come after classes
				});
			});
		}
		
		// Add subroutines with lowest priority
		const subs = documentSubs.get(textDocumentPosition.textDocument.uri);
		if (subs) {
			subs.forEach(sub => {
				const item: CompletionItem = {
					label: sub.name,
					kind: CompletionItemKind.Function,
					data: { type: 'subroutine', name: sub.name },
					sortText: '4' + sub.name // Ensures subroutines always come last
				};
				
				// Add parentheses for calling the subroutine if enabled
				if (enableAutoParentheses) {
					item.insertText = sub.name + '()';
					item.command = {
						title: 'Cursor between parentheses',
						command: 'editor.action.triggerParameterHints'
					};
				}
				
				completions.push(item);
			});
		}
		
		return completions;
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		const data = item.data as { type: string; index: number; objectName?: string; memberName?: string };
		
		if (data.type === 'keyword') {
			const keyword = smallBasicKeywords[data.index];
			item.detail = `${keyword} keyword`;
			item.documentation = getKeywordDocumentation(keyword);
		} 
		else if (data.type === 'object') {
			const object = smallBasicObjects[data.index];
			item.detail = `${object.name} object`;
			item.documentation = object.description || `${object.name} is a Small Basic object`;
		}
		else if (data.type === 'member' && data.objectName && data.memberName) {
			item.detail = `${data.objectName}.${data.memberName}`;
			item.documentation = getMemberDocumentation(data.objectName, data.memberName);
		}
		
		return item;
	}
);

function getKeywordDocumentation(keyword: string): string {
	// Add proper documentation for each keyword
	const docs: Record<string, string> = {
		'If': 'Starts a conditional statement. Format: If [condition] Then',
		'Then': 'Used with If to execute code when condition is true',
		'Else': 'Used with If to provide alternative code when condition is false',
		'ElseIf': 'Used with If to check additional conditions',
		'EndIf': 'Ends an If statement block',
		'While': 'Starts a while loop. Format: While [condition]',
		'EndWhile': 'Ends a while loop',
		'For': 'Starts a for loop. Format: For [variable] = [start] To [end] [Step [increment]]',
		'To': 'Used with For to specify the upper bound',
		'Step': 'Used with For to specify the increment value',
		'EndFor': 'Ends a for loop',
		'Sub': 'Defines a subroutine. Format: Sub [name]',
		'EndSub': 'Ends a subroutine definition',
		'Goto': 'Jumps to a label in the code',
		'And': 'Logical AND operator for combining conditions',
		'Or': 'Logical OR operator for combining conditions'
	};
	
	return docs[keyword] || `${keyword} is a Small Basic keyword`;
}

function getMemberDocumentation(objectName: string, memberName: string): string {
	const object = smallBasicObjects.find(obj => obj.name.toLowerCase() === objectName.toLowerCase());
	if (object) {
		const isMethod = object.methods?.includes(memberName);
		const isProperty = object.properties?.includes(memberName);
		
		if (isMethod) {
			return `Method: ${objectName}.${memberName}() - ${object.description}`;
		} else if (isProperty) {
			return `Property: ${objectName}.${memberName} - ${object.description}`;
		}
	}
	
	return `${objectName}.${memberName} is a Small Basic method or property`;
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
