import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface TableData {
    rows: string[];
    columns: string[];
}

let tables: { [key: string]: TableData } = {};

function loadCSVFiles(context: vscode.ExtensionContext) {
    const dataPath = path.join(context.extensionPath, 'data');
    
    try {
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
            console.log('Created data directory as it did not exist');
        }
        
        const files = fs.readdirSync(dataPath);

        files.forEach(file => {
            if (path.extname(file) === '.csv') {
                try {
                    const filePath = path.join(dataPath, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const records = parse(content, { columns: true, skip_records_with_error: true });

                    if (records.length > 1) {
                        const tableName = path.basename(file, '.csv');
                        const columns = Object.keys(records[0]);
                        
                        // skipping "type" row
                        const rows = records.slice(1).map((record: { [key: string]: string }) => record[columns[0]]);

                        tables[tableName] = {
                            rows: rows,
                            columns: columns
                        };
                        
                        console.log(`Loaded table "${tableName}" with ${rows.length} rows and ${columns.length} columns`);
                    }
                } catch (err) {
                    console.error(`Error loading CSV file ${file}:`, err);
                }
            }
        });
    } catch (err) {
        console.error('Error loading CSV files:', err);
    }
}

function getJsonContext(document: vscode.TextDocument, position: vscode.Position): {
    isTopLevel: boolean,
    currentTableName: string | null,
    currentRowName: string | null
} {
    const textBeforePosition = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    
    // counting braces
    const openBraces = (textBeforePosition.match(/{/g) || []).length;
    const closeBraces = (textBeforePosition.match(/}/g) || []).length;
    
    // something
    const isTopLevel = openBraces - closeBraces === 1;
    
    // checking if we are inside the table
    const tableMatch = textBeforePosition.match(/"(\w+)":\s*{(?![^{]*})(?:[^{]|{(?!})|{[^}]*})*$/); // what a hell is that 
    const currentTableName = tableMatch ? tableMatch[1] : null;
    
    // checking if we are inside the table row
    let currentRowName = null;
    if (currentTableName) {
        const rowMatch = textBeforePosition.match(
            new RegExp(`"${currentTableName}":\\s*{[^}]*"([^"]+)":\\s*{(?![^{]*})(?:[^{]|{(?!})|{[^}]*})*$`) // what a hell is that 
        );
        currentRowName = rowMatch ? rowMatch[1] : null;
    }
    
    return { isTopLevel, currentTableName, currentRowName };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "nulls-content-json-helper" is now active!');

    loadCSVFiles(context);

    const provider = vscode.languages.registerCompletionItemProvider(
        { language: 'json', pattern: '**/content.json' }, // filter for content.json
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const linePrefix = document.lineAt(position).text.substr(0, position.character).trim();
                
                // checking that last symbol is "
                if (!linePrefix.endsWith('"')) {
                    return undefined;
                }
                
                const context = getJsonContext(document, position);
                const completionItems: vscode.CompletionItem[] = [];
                
                // if we are at the top level in json
                if (context.isTopLevel && !context.currentTableName) {
                    // adding some fields
                    ['@title', '@description', '@author'].forEach(field => {
                        const item = new vscode.CompletionItem(field, vscode.CompletionItemKind.Property);
                        item.sortText = '0' + field; // so fields will be the first
                        completionItems.push(item);
                    });
                    
                    // adding tables
                    Object.keys(tables).forEach(table => {
                        const item = new vscode.CompletionItem(table, vscode.CompletionItemKind.Property);
                        item.sortText = '1' + table;
                        completionItems.push(item);
                    });
                }
                // if we are just inside a table
                else if (context.currentTableName && !context.currentRowName) {
                    const tableName = context.currentTableName;
                    if (tables[tableName]) {
                        tables[tableName].rows.forEach(row => {
                            const item = new vscode.CompletionItem(row, vscode.CompletionItemKind.Property);
                            completionItems.push(item);
                        });
                    }
                }
                // if we are inside a table row
                else if (context.currentTableName && context.currentRowName) {
                    const tableName = context.currentTableName;
                    if (tables[tableName] && tables[tableName].rows.includes(context.currentRowName)) {
                        tables[tableName].columns.forEach(column => {
                            const item = new vscode.CompletionItem(column, vscode.CompletionItemKind.Property);
                            completionItems.push(item);
                        });
                    }
                }
                
                return completionItems.length > 0 ? completionItems : undefined;
            }
        },
        '"' // trigger for suggestion
    );

    context.subscriptions.push(provider);
}

export function deactivate() {}