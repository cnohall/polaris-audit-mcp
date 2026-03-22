# Polaris Audit MCP Server

Run website audits directly from Claude, Cursor, or any MCP-compatible AI assistant.

## Tools

| Tool | Description |
|------|-------------|
| `audit_url` | Submit a URL for a free scan — returns a scan token |
| `get_scan_result` | Poll for results using the token from `audit_url` |
| `get_public_result` | Fetch a publicly shared report by UUID |

## Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "polaris-audit": {
      "command": "npx",
      "args": ["-y", "@polarisaudit/mcp-server"]
    }
  }
}
```

## Usage with Cursor

Add to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "polaris-audit": {
      "command": "npx",
      "args": ["-y", "@polarisaudit/mcp-server"]
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POLARIS_API_BASE` | `https://polarisaudit.com/api/scanner` | Override the API base URL (useful for self-hosting) |
| `POLARIS_API_KEY` | *(none)* | Bearer token for authenticated endpoints |

## Example conversation

> **You:** Audit https://example.com for me
>
> **Claude:** *[calls `audit_url`]* The scan has been submitted. Token: `abc123`. Let me check when it's ready...
>
> *[calls `get_scan_result` after ~45s]*
>
> Here are the results for example.com:
> - Overall grade: **B** (72/100)
> - Privacy: 65/100 — cookie banner not detected
> - Security: 80/100
> - Accessibility: 74/100
> - Performance: 68/100
>
> 3 must-fix issues and 7 quick wins identified.

## Development

```bash
npm install
npm run build
node dist/index.js   # runs the stdio server
```
