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

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

// Small Basic keywords and built-in objects
const smallBasicKeywords = [
	'If', 'Then', 'Else', 'ElseIf', 'EndIf', 'While', 'EndWhile', 
	'For', 'To', 'Step', 'EndFor', 'Sub', 'EndSub', 'Goto', 'And', 'Or', 'Not'
];

// Comprehensive list of all Small Basic objects and their members
const smallBasicObjects = [
	{ 
		name: 'Array', 
		members: [
			'ContainsIndex', 'ContainsValue', 'GetAllIndices', 'GetItemCount', 
			'GetValue', 'IsArray', 'RemoveValue', 'SetValue'
		] 
	},
	{ 
		name: 'Clock', 
		members: [
			'Date', 'Day', 'ElapsedMilliseconds', 'Hour', 'Millisecond', 'Minute', 
			'Month', 'Second', 'Time', 'TimeZone', 'WeekDay', 'Year'
		] 
	},
	{ 
		name: 'Controls', 
		members: [
			'AddButton', 'AddMultiLineTextBox', 'AddTextBox', 'ButtonClicked', 
			'GetButtonCaption', 'GetTextBoxText', 'HideControl', 
			'LastClickedButton', 'Remove', 'SetButtonCaption', 'SetSize', 'SetTextBoxText', 'ShowControl'
		] 
	},
	{ 
		name: 'Desktop', 
		members: [
			'Height', 'Width'
		] 
	},
	{ 
		name: 'Dictionary', 
		members: [
			'AddValue', 'ContainsKey', 'ContainsValue', 'GetItemCount', 
			'GetKeys', 'GetValue', 'RemoveValue'
		] 
	},
	{ 
		name: 'File', 
		members: [
			'AppendContents', 'CopyFile', 'CreateDirectory', 'DeleteDirectory', 
			'DeleteFile', 'GetDirectories', 'GetFiles', 'GetSettingsFilePath', 'GetTemporaryFilePath', 
			'InsertLine', 'ReadContents', 'ReadLine', 'WriteContents', 'WriteLine'
		] 
	},
	{ 
		name: 'Flickr', 
		members: [
			'GetPictureOfMoment', 'GetRandomPicture', 'GetRandomPictureOfPlace'
		] 
	},
	{ 
		name: 'GraphicsWindow', 
		members: [
			'BackgroundColor', 'BrushColor', 'CanResize', 'Clear', 'DrawBoundText',
			'DrawEllipse', 'DrawImage', 'DrawLine', 'DrawRectangle', 'DrawResizedImage',
			'DrawText', 'DrawTriangle', 'FillEllipse', 'FillRectangle', 'FillTriangle',
			'FontBold', 'FontItalic', 'FontName', 'FontSize', 'GetColorFromRGB',
			'GetLeft', 'GetPixel', 'GetRandomColor', 'GetTop', 'Height',
			'Hide', 'KeyDown', 'KeyUp', 'LastKey', 'Left',
			'MouseDown', 'MouseMove', 'MouseUp', 'MouseX', 'MouseY',
			'PenColor', 'PenWidth', 'SetPixel', 'Show', 'ShowMessage',
			'Title', 'Top', 'Width'
		] 
	},
	{ 
		name: 'ImageList', 
		members: [
			'GetHeightOfImage', 'GetWidthOfImage', 'LoadImage'
		] 
	},
	{ 
		name: 'Math', 
		members: [
			'Abs', 'Ceiling', 'Cos', 'Floor', 'GetDegrees',
			'GetRadians', 'GetRandomNumber', 'Max', 'Min', 'NaturalLog',
			'Pi', 'Power', 'Remainder', 'Round', 'Sin',
			'SquareRoot', 'Tan'
		] 
	},
	{ 
		name: 'Mouse', 
		members: [
			'ButtonDown', 'ButtonUp', 'HideCursor', 'IsLeftButtonDown', 'IsMiddleButtonDown', 'IsRightButtonDown',
			'MouseX', 'MouseY', 'ShowCursor', 'WheelDelta', 'WheelDown', 'WheelUp'
		] 
	},
	{ 
		name: 'Network', 
		members: [
			'DownloadFile', 'DownloadImage', 'GetWebPageContents', 'IsConnected'
		] 
	},
	{ 
		name: 'Program', 
		members: [
			'Delay', 'Directory', 'End', 'GetArgument', 'Pause',
			'SetArgument'
		] 
	},
	{ 
		name: 'Shapes', 
		members: [
			'AddEllipse', 'AddImage', 'AddLine', 'AddRectangle', 'AddText',
			'AddTriangle', 'Animate', 'GetLeft', 'GetOpacity', 'GetTop',
			'GetX', 'GetY', 'HideShape', 'Move', 'Remove', 'Resize',
			'Rotate', 'SetOpacity', 'SetText', 'ShowShape', 'Zoom'
		] 
	},
	{ 
		name: 'Sound', 
		members: [
			'Play', 'PlayAndWait', 'PlayBackgroundSound', 'PlayBellRing', 'PlayChime', 'PlayClick',
			'PlayChimes', 'PlayMusic', 'PlayMusicAndWait', 'PlaySystemSound', 'StopBackgroundSound'
		] 
	},
	{ 
		name: 'Stack', 
		members: [
			'GetCount', 'PopValue', 'PushValue'
		] 
	},
	{ 
		name: 'Text', 
		members: [
			'Append', 'ConvertToLowerCase', 'ConvertToUpperCase', 'EndsWith',
			'GetCharacter', 'GetCharacterCode', 'GetIndexOf', 'GetLength',
			'GetSubText', 'GetSubTextToEnd', 'IsSubText', 'StartsWith'
		]
	},
	{ 
		name: 'TextWindow', 
		members: [
			'BackgroundColor', 'Clear', 'CursorLeft', 'CursorTop', 'ForegroundColor',
			'Hide', 'Pause', 'PauseIfVisible', 'PauseWithoutMessage', 'Read',
			'ReadKey', 'ReadNumber', 'ReadLine', 'Show', 'Title', 'Write',
			'WriteLine'
		] 
	},
	{ 
		name: 'Timer', 
		members: [
			'Interval', 'Pause', 'Resume', 'Tick'
		] 
	},
	{ 
		name: 'Turtle', 
		members: [
			'Angle', 'Distance', 'Hide', 'Move', 'MoveTo',
			'PenDown', 'PenUp', 'Show', 'Speed', 'Turn',
			'TurnLeft', 'TurnRight', 'X', 'Y'
		] 
	}
];

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
	const diagnostics: Diagnostic[] = [];
	
	// This is a simple syntax check for Small Basic
	// Looking for unclosed If statements, While loops, etc.
	
	// Check for If/EndIf balance
	const ifMatches = text.match(/\bIf\b/gi) || [];
	const endIfMatches = text.match(/\bEndIf\b/gi) || [];
	
	if (ifMatches.length > endIfMatches.length) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(0),
				end: textDocument.positionAt(text.length)
			},
			message: 'Missing EndIf statement',
			source: 'Small Basic'
		});
	}
	
	// Check for While/EndWhile balance
	const whileMatches = text.match(/\bWhile\b/gi) || [];
	const endWhileMatches = text.match(/\bEndWhile\b/gi) || [];
	
	if (whileMatches.length > endWhileMatches.length) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(0),
				end: textDocument.positionAt(text.length)
			},
			message: 'Missing EndWhile statement',
			source: 'Small Basic'
		});
	}
	
	// Check for For/EndFor balance
	const forMatches = text.match(/\bFor\b/gi) || [];
	const endForMatches = text.match(/\bEndFor\b/gi) || [];
	
	if (forMatches.length > endForMatches.length) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(0),
				end: textDocument.positionAt(text.length)
			},
			message: 'Missing EndFor statement',
			source: 'Small Basic'
		});
	}
	
	// Check for Sub/EndSub balance
	const subMatches = text.match(/\bSub\b/gi) || [];
	const endSubMatches = text.match(/\bEndSub\b/gi) || [];
	
	if (subMatches.length > endSubMatches.length) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(0),
				end: textDocument.positionAt(text.length)
			},
			message: 'Missing EndSub statement',
			source: 'Small Basic'
		});
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
				return object.members.map(member => {
					const isMethod = !object.members.some(m => m === member && 
						(member === 'BackgroundColor' || member === 'BrushColor' || member.endsWith('X') || 
						 member.endsWith('Y') || member === 'Width' || member === 'Height' ||
						 member === 'Left' || member === 'Top' || member === 'Title'));
					
					const item: CompletionItem = {
						label: member,
						kind: isMethod ? CompletionItemKind.Method : CompletionItemKind.Property,
						data: { type: 'member', objectName: object.name, memberName: member }
					};
					
					// Add parentheses to method calls if enabled
					if (isMethod && enableAutoParentheses) {
						item.insertText = member + '()';
						item.command = {
							title: 'Cursor between parentheses',
							command: 'editor.action.triggerParameterHints'
						};
					}
					
					return item;
				});
			}
			
			return [];
		}

		// Regular keyword and object completion
		const completions: CompletionItem[] = [];
		
		// Add keywords
		smallBasicKeywords.forEach((keyword, index) => {
			completions.push({
				label: keyword,
				kind: CompletionItemKind.Keyword,
				data: { type: 'keyword', index }
			});
		});
		
		// Add objects
		smallBasicObjects.forEach((object, index) => {
			completions.push({
				label: object.name,
				kind: CompletionItemKind.Class,
				data: { type: 'object', index }
			});
		});
		
		// Add variables from the current document
		const variables = documentVariables.get(textDocumentPosition.textDocument.uri);
		if (variables) {
			variables.forEach(variable => {
				completions.push({
					label: variable.name,
					kind: CompletionItemKind.Variable,
					detail: `(${variable.type})`,
					data: { type: 'variable', name: variable.name }
				});
			});
		}
		
		// Add subroutines from the current document
		const subs = documentSubs.get(textDocumentPosition.textDocument.uri);
		if (subs) {
			subs.forEach(sub => {
				const item: CompletionItem = {
					label: sub.name,
					kind: CompletionItemKind.Function,
					data: { type: 'subroutine', name: sub.name }
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
			item.documentation = getObjectDocumentation(object.name);
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

function getObjectDocumentation(objectName: string): string {
	// Add proper documentation for each object
	const docs: Record<string, string> = {
		'GraphicsWindow': 'Provides methods for creating and manipulating graphics',
		'TextWindow': 'Provides methods for console input and output',
		'Math': 'Provides mathematical functions and operations',
		'Array': 'Provides methods to work with arrays',
		'Program': 'Provides program control functions',
		'Clock': 'Provides access to date and time information',
		'Shapes': 'Provides methods to create and manipulate shapes',
		'File': 'Provides file system operations',
		'Text': 'Provides methods for text manipulation and processing',
		'Mouse': 'Provides access to mouse input and cursor control',
		'Network': 'Provides methods for network operations',
		'Sound': 'Provides methods for playing sounds and music',
		'Turtle': 'Provides methods for turtle graphics',
		'Timer': 'Provides timer functionality',
		'Controls': 'Provides methods for creating user interface controls',
		'Stack': 'Provides methods for stack operations',
		'Dictionary': 'Provides methods for key-value pair collections',
		'ImageList': 'Provides methods for working with images',
		'Desktop': 'Provides information about the desktop',
		'Flickr': 'Provides access to Flickr images'
	};
	
	return docs[objectName] || `${objectName} is a Small Basic object`;
}

function getMemberDocumentation(objectName: string, memberName: string): string {
	// Add proper documentation for each member
	const docs: Record<string, Record<string, string>> = {
		'GraphicsWindow': {
				'BackgroundColor': 'Sets or gets the background color. Usage: GraphicsWindow.BackgroundColor = "color"',
				'BrushColor': 'Sets or gets the brush color used for filling shapes. Usage: GraphicsWindow.BrushColor = "color"',
				'CanResize': 'Sets or gets whether the window can be resized. Usage: GraphicsWindow.CanResize = "true" or "false"',
				'Clear': 'Clears the graphics window. Usage: GraphicsWindow.Clear()',
				'DrawBoundText': 'Draws text within specified boundaries. Usage: GraphicsWindow.DrawBoundText(x, y, width, text)',
				'DrawEllipse': 'Draws an ellipse. Usage: GraphicsWindow.DrawEllipse(x, y, width, height)',
				'DrawImage': 'Draws an image. Usage: GraphicsWindow.DrawImage(imageName, x, y)',
				'DrawLine': 'Draws a line between two points. Usage: GraphicsWindow.DrawLine(x1, y1, x2, y2)',
				'DrawRectangle': 'Draws a rectangle. Usage: GraphicsWindow.DrawRectangle(x, y, width, height)',
				'DrawResizedImage': 'Draws a resized image. Usage: GraphicsWindow.DrawResizedImage(imageName, x, y, width, height)',
				'DrawText': 'Draws text at specified position. Usage: GraphicsWindow.DrawText(x, y, text)',
				'DrawTriangle': 'Draws a triangle. Usage: GraphicsWindow.DrawTriangle(x1, y1, x2, y2, x3, y3)',
				'FillEllipse': 'Draws a filled ellipse. Usage: GraphicsWindow.FillEllipse(x, y, width, height)',
				'FillRectangle': 'Draws a filled rectangle. Usage: GraphicsWindow.FillRectangle(x, y, width, height)',
				'FillTriangle': 'Draws a filled triangle. Usage: GraphicsWindow.FillTriangle(x1, y1, x2, y2, x3, y3)',
				'FontBold': 'Sets or gets whether the font is bold. Usage: GraphicsWindow.FontBold = "true" or "false"',
				'FontItalic': 'Sets or gets whether the font is italic. Usage: GraphicsWindow.FontItalic = "true" or "false"',
				'FontName': 'Sets or gets the font name. Usage: GraphicsWindow.FontName = "fontName"',
				'FontSize': 'Sets or gets the font size. Usage: GraphicsWindow.FontSize = size',
				'GetColorFromRGB': 'Gets a color from RGB values. Usage: color = GraphicsWindow.GetColorFromRGB(red, green, blue)',
				'GetLeft': 'Gets the left position of the window. Usage: left = GraphicsWindow.GetLeft()',
				'GetPixel': 'Gets the color of a pixel. Usage: color = GraphicsWindow.GetPixel(x, y)',
				'GetRandomColor': 'Gets a random color. Usage: color = GraphicsWindow.GetRandomColor()',
				'GetTop': 'Gets the top position of the window. Usage: top = GraphicsWindow.GetTop()',
				'Height': 'Sets or gets the height of the window. Usage: GraphicsWindow.Height = height or height = GraphicsWindow.Height',
				'Hide': 'Hides the graphics window. Usage: GraphicsWindow.Hide()',
				'KeyDown': 'Event that fires when a key is pressed.',
				'KeyUp': 'Event that fires when a key is released.',
				'LastKey': 'Gets the last key pressed. Usage: key = GraphicsWindow.LastKey',
				'Left': 'Sets or gets the left position of the window. Usage: GraphicsWindow.Left = left or left = GraphicsWindow.Left',
				'MouseDown': 'Event that fires when a mouse button is pressed.',
				'MouseMove': 'Event that fires when the mouse is moved.',
				'MouseUp': 'Event that fires when a mouse button is released.',
				'MouseX': 'Gets the x coordinate of the mouse. Usage: x = GraphicsWindow.MouseX',
				'MouseY': 'Gets the y coordinate of the mouse. Usage: y = GraphicsWindow.MouseY',
				'PenColor': 'Sets or gets the pen color. Usage: GraphicsWindow.PenColor = "color"',
				'PenWidth': 'Sets or gets the pen width. Usage: GraphicsWindow.PenWidth = width',
				'SetPixel': 'Sets the color of a pixel. Usage: GraphicsWindow.SetPixel(x, y, color)',
				'Show': 'Shows the graphics window. Usage: GraphicsWindow.Show()',
				'ShowMessage': 'Shows a message box. Usage: GraphicsWindow.ShowMessage(text, title)',
				'Title': 'Sets or gets the title of the window. Usage: GraphicsWindow.Title = "title" or title = GraphicsWindow.Title',
				'Top': 'Sets or gets the top position of the window. Usage: GraphicsWindow.Top = top or top = GraphicsWindow.Top',
				'Width': 'Sets or gets the width of the window. Usage: GraphicsWindow.Width = width or width = GraphicsWindow.Width'
			},
			'TextWindow': {
				'BackgroundColor': 'Sets or gets the background color of the text window. Usage: TextWindow.BackgroundColor = "color"',
				'Clear': 'Clears the text window. Usage: TextWindow.Clear()',
				'CursorLeft': 'Sets or gets the column position of the cursor. Usage: TextWindow.CursorLeft = position or position = TextWindow.CursorLeft',
				'CursorTop': 'Sets or gets the row position of the cursor. Usage: TextWindow.CursorTop = position or position = TextWindow.CursorTop',
				'ForegroundColor': 'Sets or gets the text color. Usage: TextWindow.ForegroundColor = "color"',
				'Hide': 'Hides the text window. Usage: TextWindow.Hide()',
				'Pause': 'Waits for the user to press a key. Usage: TextWindow.Pause()',
				'PauseIfVisible': 'Pauses only if the text window is visible. Usage: TextWindow.PauseIfVisible()',
				'PauseWithoutMessage': 'Pauses without showing any message. Usage: TextWindow.PauseWithoutMessage()',
				'Read': 'Reads a character from the console. Usage: var = TextWindow.Read()',
				'ReadKey': 'Reads a single key press. Usage: key = TextWindow.ReadKey()',
				'ReadNumber': 'Reads a number from the console. Usage: num = TextWindow.ReadNumber()',
				'Show': 'Shows the text window. Usage: TextWindow.Show()',
				'Title': 'Sets or gets the title of the text window. Usage: TextWindow.Title = "title" or title = TextWindow.Title',
				'Write': 'Writes text without a new line. Usage: TextWindow.Write(text)',
				'WriteLine': 'Writes text with a new line. Usage: TextWindow.WriteLine(text)'
			},
			'Math': {
				'Abs': 'Returns the absolute value of a number. Usage: result = Math.Abs(number)',
				'Ceiling': 'Returns the smallest integer greater than or equal to a number. Usage: result = Math.Ceiling(number)',
				'Cos': 'Returns the cosine of an angle in radians. Usage: result = Math.Cos(angle)',
				'Floor': 'Returns the largest integer less than or equal to a number. Usage: result = Math.Floor(number)',
				'GetDegrees': 'Converts radians to degrees. Usage: degrees = Math.GetDegrees(radians)',
				'GetRadians': 'Converts degrees to radians. Usage: radians = Math.GetRadians(degrees)',
				'GetRandomNumber': 'Returns a random number up to a maximum value. Usage: number = Math.GetRandomNumber(max)',
				'Max': 'Returns the larger of two numbers. Usage: max = Math.Max(number1, number2)',
				'Min': 'Returns the smaller of two numbers. Usage: min = Math.Min(number1, number2)',
				'NaturalLog': 'Returns the natural logarithm of a number. Usage: result = Math.NaturalLog(number)',
				'Pi': 'Returns the value of Pi. Usage: pi = Math.Pi',
				'Power': 'Returns a number raised to a power. Usage: result = Math.Power(number, power)',
				'Remainder': 'Returns the remainder of a division. Usage: remainder = Math.Remainder(dividend, divisor)',
				'Round': 'Rounds a number to the nearest integer. Usage: result = Math.Round(number)',
				'Sin': 'Returns the sine of an angle in radians. Usage: result = Math.Sin(angle)',
				'SquareRoot': 'Returns the square root of a number. Usage: result = Math.SquareRoot(number)',
				'Tan': 'Returns the tangent of an angle in radians. Usage: result = Math.Tan(angle)'
			},
			'Array': {
				'ContainsIndex': 'Checks if an array contains a specific index. Usage: result = Array.ContainsIndex(array, index)',
				'ContainsValue': 'Checks if an array contains a specific value. Usage: result = Array.ContainsValue(array, value)',
				'GetAllIndices': 'Gets all indices of an array. Usage: indices = Array.GetAllIndices(array)',
				'GetItemCount': 'Gets the number of items in an array. Usage: count = Array.GetItemCount(array)',
				'GetValue': 'Gets a value from an array. Usage: value = Array.GetValue(array, index)',
				'IsArray': 'Checks if a variable is an array. Usage: result = Array.IsArray(variable)',
				'RemoveValue': 'Removes a value from an array. Usage: Array.RemoveValue(array, index)',
				'SetValue': 'Sets a value in an array. Usage: Array.SetValue(array, index, value)'
			},
			'Text': {
				'Append': 'Appends text to another text. Usage: result = Text.Append(text1, text2)',
				'ConvertToLowerCase': 'Converts text to lowercase. Usage: result = Text.ConvertToLowerCase(text)',
				'ConvertToUpperCase': 'Converts text to uppercase. Usage: result = Text.ConvertToUpperCase(text)',
				'EndsWith': 'Checks if text ends with specific text. Usage: result = Text.EndsWith(text, value)',
				'GetCharacter': 'Gets the character at a specific position. Usage: char = Text.GetCharacter(text, index)',
				'GetCharacterCode': 'Gets the character code at a position. Usage: code = Text.GetCharacterCode(text, index)',
				'GetIndexOf': 'Gets the position of text within other text. Usage: index = Text.GetIndexOf(text, value)',
				'GetLength': 'Gets the length of text. Usage: length = Text.GetLength(text)',
				'GetSubText': 'Gets a portion of text. Usage: result = Text.GetSubText(text, start, length)',
				'GetSubTextToEnd': 'Gets text from position to end. Usage: result = Text.GetSubTextToEnd(text, start)',
				'IsSubText': 'Checks if text contains other text. Usage: result = Text.IsSubText(text, value)',
				'StartsWith': 'Checks if text starts with specific text. Usage: result = Text.StartsWith(text, value)'
			},
			'Network': {
				'DownloadFile': 'Downloads a file from a URL. Usage: Network.DownloadFile(url, filePath)',
				'DownloadImage': 'Downloads an image from a URL. Usage: image = Network.DownloadImage(url)',
				'GetWebPageContents': 'Gets the contents of a web page. Usage: content = Network.GetWebPageContents(url)',
				'IsConnected': 'Checks if the computer is connected to the internet. Usage: result = Network.IsConnected()'
			},
			'Mouse': {
				'ButtonDown': 'Event that fires when a mouse button is pressed.',
				'ButtonUp': 'Event that fires when a mouse button is released.',
				'HideCursor': 'Hides the mouse cursor. Usage: Mouse.HideCursor()',
				'IsLeftButtonDown': 'Checks if left mouse button is pressed. Usage: result = Mouse.IsLeftButtonDown()',
				'IsMiddleButtonDown': 'Checks if middle mouse button is pressed. Usage: result = Mouse.IsMiddleButtonDown()',
				'IsRightButtonDown': 'Checks if right mouse button is pressed. Usage: result = Mouse.IsRightButtonDown()',
				'MouseX': 'Gets the X coordinate of the mouse. Usage: x = Mouse.MouseX',
				'MouseY': 'Gets the Y coordinate of the mouse. Usage: y = Mouse.MouseY',
				'ShowCursor': 'Shows the mouse cursor. Usage: Mouse.ShowCursor()',
				'WheelDelta': 'Gets the mouse wheel delta. Usage: delta = Mouse.WheelDelta',
				'WheelDown': 'Event that fires when mouse wheel is scrolled down.',
				'WheelUp': 'Event that fires when mouse wheel is scrolled up.'
			}
		};
		
		return docs[objectName]?.[memberName] || `${objectName}.${memberName} is a Small Basic method or property`;
	}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
