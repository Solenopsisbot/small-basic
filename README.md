# Small Basic for Visual Studio Code

This extension adds language support for Microsoft Small Basic to Visual Studio Code.

## Features

This Language Server provides the following features for Small Basic files:
- Syntax highlighting for Small Basic (.sb) files
- Code completion for Small Basic keywords, objects, and methods
- Code snippets for common control structures (If/EndIf, For/EndFor, etc.)
- Auto-insertion of parentheses for method calls
- Variable and subroutine tracking for better IntelliSense support
- Diagnostics for basic syntax errors (e.g., missing EndIf, EndWhile, etc.)
- Folding regions for blocks (Sub/EndSub, If/EndIf, etc.)
- Automatic indentation for control structures

## Code Snippets

Type any of the following prefixes to activate snippets:
- `if` - Creates an If/EndIf block
- `ifelse` - Creates an If/Else/EndIf block
- `for` - Creates a For/EndFor loop
- `forstep` - Creates a For/EndFor loop with Step
- `while` - Creates a While/EndWhile loop
- `sub` - Creates a Sub/EndSub definition
- `gwinit` - GraphicsWindow initialization with common properties
- `twinit` - TextWindow initialization with common properties

## Small Basic Language

Small Basic is a simplified programming language designed by Microsoft to make learning programming easy and fun. It features:
- Simple syntax inspired by BASIC
- Built-in objects for graphics, math, file handling, etc.
- Limited set of keywords to reduce complexity

## Running the Extension

- Run `npm install` in this folder. This installs all necessary npm modules in both the client and server folder
- Open VS Code on this folder.
- Press Ctrl+Shift+B to start compiling the client and server in [watch mode](https://code.visualstudio.com/docs/editor/tasks#:~:text=The%20first%20entry%20executes,the%20HelloWorld.js%20file.).
- Switch to the Run and Debug View in the Sidebar (Ctrl+Shift+D).
- Select `Launch Client` from the drop down (if it is not already).
- Press ▷ to run the launch config (F5).
- In the [Extension Development Host](https://code.visualstudio.com/api/get-started/your-first-extension#:~:text=Then%2C%20inside%20the%20editor%2C%20press%20F5.%20This%20will%20compile%20and%20run%20the%20extension%20in%20a%20new%20Extension%20Development%20Host%20window.) instance of VSCode, open a Small Basic (.sb) file.
  - Type Small Basic keywords and object names to see completion suggestions.
  - Type variable names to get automatic completion.
  - Type the start of a control structure like `if` to trigger snippets.
  - Write code with syntax errors to see diagnostics.

## Extension Settings

This extension contributes the following settings:

* `smallBasic.maxNumberOfProblems`: Controls the maximum number of problems reported.
* `smallBasic.enableAutoParentheses`: Controls whether to automatically add parentheses after method completion.
