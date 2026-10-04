const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|pre)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

const formatBytes = (n) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

export const WebFetchTool = {
  name: 'WebFetch',
  description: 'Fetches a URL and returns its content as plain text.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      prompt: { type: 'string', description: 'What to extract from the page' },
    },
    required: ['url'],
  },
  userFacingName: () => 'Fetch',
  renderInput: (input) => input.url,
  domain(input) {
    try {
      return new URL(input.url).hostname;
    } catch {
      return input.url;
    }
  },
  validate(input) {
    try {
      const u = new URL(input.url);
      if (!/^https?:$/.test(u.protocol)) return 'Only http(s) URLs are supported.';
    } catch {
      return `Invalid URL: ${input.url}`;
    }
    return null;
  },
  async call(input, ctx) {
    const url = input.url.replace(/^http:\/\//, 'https://');
    const res = await fetch(url, { signal: ctx.signal, headers: { 'user-agent': 'ZeroCode/0.1 (+cli)' }, redirect: 'follow' });
    const body = await res.text();
    const type = res.headers.get('content-type') || '';
    const text = type.includes('html') ? htmlToText(body) : body;
    const MAX = 20_000;
    return {
      output: (text.length > MAX ? text.slice(0, MAX) + '\n\n[content truncated]' : text) || '(empty response)',
      isError: !res.ok,
      display: { kind: 'summary', text: { key: 'tool.received', size: formatBytes(Buffer.byteLength(body)), status: `${res.status} ${res.statusText}` } },
      data: { text, status: res.status },
    };
  },
};

export const TodoWriteTool = {
  name: 'TodoWrite',
  description: 'Creates and manages a structured task list for the current session.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string' },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  isReadOnly: true,
  userFacingName: () => 'Update Todos',
  renderInput: () => '',
  async call(input, ctx) {
    ctx.todos.splice(0, ctx.todos.length, ...input.todos);
    return {
      output: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.',
      display: { kind: 'todos', todos: input.todos },
    };
  },
};
