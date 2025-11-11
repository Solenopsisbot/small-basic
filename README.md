# Small Basic for Visual Studio Code

Bring Microsoft Small Basic into Visual Studio Code! This extension makes programming in Small Basic a breeze with modern code editing features while maintaining the simple and educational nature of Small Basic.


## Features

- **Run Small Basic directly in VS Code** - Press F5 to instantly run your code!
- **Modern code editing** - Syntax highlighting, code completion, and snippets
- **Code intelligence** - Auto-indentation, folding, and diagnostics
- **Easy to use** - No complicated setup, just install and start coding


## Requirements

First, make sure you have Microsoft Small Basic installed:
- Download from [Microsoft Small Basic website](https://smallbasic-publicwebsite.azurewebsites.net/)
- Follow the installation instructions

## Time-Saving Snippets

Type these prefixes and press Tab to quickly insert code blocks:

| Snippet  | Description |
|----------|-------------|
| `if`     | Creates an If/EndIf block |
| `ifelse` | Creates an If/Else/EndIf block |
| `for`    | Creates a For/EndFor loop |
| `while`  | Creates a While/EndWhile loop |
| `sub`    | Creates a Sub/EndSub definition |
| `gwinit` | GraphicsWindow initialization with common properties |
| `twinit` | TextWindow initialization with common properties |

## Commands

- `F5` - Run your Small Basic program
- `Run And Debug` - Run your Small Basic program

## Settings

- `smallBasic.compilerPath`: Path to the Small Basic compiler executable (change if installed in a non-default location)
- `smallBasic.enableAutoParentheses`: Controls whether to automatically add parentheses after method completion
- `smallBasic.maxNumberOfProblems`: Controls the maximum number of problems reported

## Troubleshooting

**Program won't run?** Ensure Small Basic is installed and the compiler path is correctly set in the extension settings.

**Seeing errors?** Check the Output panel for detailed error messages and diagnostics.

## Acknowledgments

This extension was developed with assistance from AI tools, including GitHub Copilot, to enhance code quality and development speed.

## License

This extension is licensed under the MIT License.
