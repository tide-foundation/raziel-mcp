import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const didChangeEmitter = new vscode.EventEmitter<void>();

  // Re-register when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tide.mcp")) {
        didChangeEmitter.fire();
      }
    })
  );

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("tideMcp", {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,

      provideMcpServerDefinitions: async () => {
        const config = vscode.workspace.getConfiguration("tide.mcp");
        const mode = config.get<string>("mode", "remote");

        if (mode === "local") {
          return [
            new vscode.McpStdioServerDefinition(
              "Raziel",
              "npx",
              ["-y", "@tideorg/mcp"],
              {},
              "1.9.6"
            ),
          ];
        }

        // Default: remote
        const url = config.get<string>(
          "remoteUrl",
          "https://mcp.tide.org/mcp"
        );
        return [
          new vscode.McpHttpServerDefinition(
            "Raziel",
            vscode.Uri.parse(url),
            {},
            "1.9.6"
          ),
        ];
      },

      resolveMcpServerDefinition: async (server) => server,
    })
  );
}

export function deactivate() {}
