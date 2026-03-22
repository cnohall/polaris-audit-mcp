#!/usr/bin/env node
/**
 * Polaris Audit MCP Server
 *
 * Exposes Polaris Audit's website scanning capabilities as MCP tools so that
 * AI assistants (Claude, Cursor, etc.) can audit URLs and retrieve results
 * without leaving the conversation.
 *
 * Tools:
 *   audit_url          — Submit a URL for a free scan (no auth required)
 *   get_scan_result    — Poll for completed scan results by token
 *   get_public_result  — Fetch a previously-shared public result by UUID
 *
 * Usage (stdio transport — works with Claude Desktop, Cursor, etc.):
 *   node dist/index.js
 *
 * Environment variables:
 *   POLARIS_API_BASE   — Override default API base URL
 *                        Default: https://polarisaudit.com/api/scanner
 *   POLARIS_API_KEY    — Optional bearer token for authenticated endpoints
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE =
  process.env.POLARIS_API_BASE ?? 'https://polarisaudit.com/api/scanner';
const API_KEY = process.env.POLARIS_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new McpError(
      ErrorCode.InternalError,
      `API request failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'audit_url',
    description:
      'Submit a website URL for a free Polaris Audit scan. Returns a scan token you can use with get_scan_result to retrieve the completed report. The scan typically completes within 30–60 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The full URL to audit, including protocol (e.g. https://example.com)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_scan_result',
    description:
      'Retrieve the results of a previously submitted scan using the scan token returned by audit_url. If the scan is still running, poll again after a few seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'The scan token returned by audit_url',
        },
      },
      required: ['token'],
    },
  },
  {
    name: 'get_public_result',
    description:
      'Fetch a publicly shared Polaris Audit report by its UUID. Returns scores for privacy, security, accessibility, and performance plus a summary of key findings.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: {
          type: 'string',
          description: 'The UUID of a publicly shared scan result',
        },
      },
      required: ['uuid'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleAuditUrl(args: { url: string }): Promise<string> {
  const data = (await apiFetch('/free-scan/', {
    method: 'POST',
    body: JSON.stringify({ url: args.url }),
  })) as Record<string, unknown>;

  // The free-scan endpoint returns { scan_token, message, ... }
  const token = data.scan_token ?? data.token;
  if (!token) {
    return JSON.stringify(data, null, 2);
  }

  return JSON.stringify(
    {
      scan_token: token,
      message: `Scan submitted for ${args.url}. Use get_scan_result with this token to retrieve results once complete (usually 30–60 seconds).`,
      url: args.url,
    },
    null,
    2,
  );
}

async function handleGetScanResult(args: { token: string }): Promise<string> {
  const data = await apiFetch(`/free-scan/${args.token}`);
  return JSON.stringify(data, null, 2);
}

async function handleGetPublicResult(args: { uuid: string }): Promise<string> {
  const data = (await apiFetch(`/public/results/${args.uuid}/`)) as Record<
    string,
    unknown
  >;

  // Produce a concise human-readable summary alongside the raw data
  const summary = buildSummary(data);
  return `${summary}\n\n---\nRaw data:\n${JSON.stringify(data, null, 2)}`;
}

function buildSummary(d: Record<string, unknown>): string {
  const lines: string[] = [];
  if (d.url) lines.push(`URL: ${d.url}`);
  if (d.grade) lines.push(`Grade: ${d.grade}  (${d.overall_score}/100)`);
  if (typeof d.privacy_score === 'number')
    lines.push(`  Privacy:       ${d.privacy_score}/100`);
  if (typeof d.security_score === 'number')
    lines.push(`  Security:      ${d.security_score}/100`);
  if (typeof d.accessibility_score === 'number')
    lines.push(`  Accessibility: ${d.accessibility_score}/100`);
  if (typeof d.performance_score === 'number')
    lines.push(`  Performance:   ${d.performance_score}/100`);
  if (typeof d.must_fix_count === 'number')
    lines.push(`Must-fix issues: ${d.must_fix_count}`);
  if (typeof d.quick_wins_count === 'number')
    lines.push(`Quick wins:      ${d.quick_wins_count}`);

  const ps = d.privacy_summary as Record<string, unknown> | undefined;
  if (ps) {
    lines.push(
      `Cookie banner: ${ps.cookie_banner_found ? 'found' : 'not found'}`,
    );
    lines.push(
      `Privacy policy: ${ps.privacy_policy_found ? 'found' : 'not found'}`,
    );
    if (typeof ps.third_party_count === 'number')
      lines.push(`Third-party scripts: ${ps.third_party_count}`);
  }

  if (d.scanned_at) {
    lines.push(`Scanned: ${new Date(d.scanned_at as string).toLocaleString()}`);
  }

  const shareUrl = d.uuid
    ? `https://polarisaudit.com/results/${d.uuid}`
    : null;
  if (shareUrl) lines.push(`Public report: ${shareUrl}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'polaris-audit', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'audit_url':
        result = await handleAuditUrl(args as { url: string });
        break;

      case 'get_scan_result':
        result = await handleGetScanResult(args as { token: string });
        break;

      case 'get_public_result':
        result = await handleGetPublicResult(args as { uuid: string });
        break;

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new McpError(ErrorCode.InternalError, message);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening on stdin/stdout — do not write to stdout
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
