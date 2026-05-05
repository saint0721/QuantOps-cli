import { stdin, stdout } from 'node:process';
import { runTool, toolSummaries } from './tools.ts';
import type { JsonObject, JsonValue } from './storage.ts';

export type McpServerOptions = {
  base?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: JsonObject };

function response(id: RpcMessage['id'], result: JsonObject): JsonObject {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id: RpcMessage['id'], code: number, message: string): JsonObject {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export async function handleMcpMessage(message: RpcMessage, options: { base?: string } = {}): Promise<JsonObject | null> {
  if (!message.id && String(message.method ?? '').startsWith('notifications/')) return null;
  if (message.method === 'initialize') {
    return response(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'tossquant-cli', version: '0.1.0' },
    });
  }
  if (message.method === 'tools/list') {
    return response(message.id, {
      tools: toolSummaries().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    });
  }
  if (message.method === 'tools/call') {
    const params = message.params ?? {};
    const name = String(params.name ?? '');
    const args = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as JsonObject;
    const result = await runTool(name, args, { base: options.base });
    return response(message.id, {
      content: [{ type: 'text', text: JSON.stringify(result.output, null, 2) }],
      isError: !result.ok,
    });
  }
  return errorResponse(message.id, -32601, `method not found: ${message.method ?? ''}`);
}

function encodeMessage(message: JsonObject): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function extractMessages(buffer: Buffer): { messages: RpcMessage[]; rest: Buffer } {
  const messages: RpcMessage[] = [];
  let rest = buffer;
  for (;;) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const header = rest.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) return { messages, rest };
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (rest.length - start < length) return { messages, rest };
      const body = rest.subarray(start, start + length).toString('utf8');
      messages.push(JSON.parse(body) as RpcMessage);
      rest = rest.subarray(start + length);
      continue;
    }
    const newline = rest.indexOf('\n');
    if (newline < 0) return { messages, rest };
    const line = rest.subarray(0, newline).toString('utf8').trim();
    rest = rest.subarray(newline + 1);
    if (line) messages.push(JSON.parse(line) as RpcMessage);
  }
}

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')]);
    const extracted = extractMessages(buffer);
    buffer = extracted.rest;
    for (const message of extracted.messages) {
      const reply = await handleMcpMessage(message, { base: options.base });
      if (reply) output.write(encodeMessage(reply));
    }
  }
}

export async function runMcpMessages(messages: RpcMessage[], options: { base?: string } = {}): Promise<JsonObject[]> {
  const replies: JsonObject[] = [];
  for (const message of messages) {
    const reply = await handleMcpMessage(message, options);
    if (reply) replies.push(reply);
  }
  return replies;
}
