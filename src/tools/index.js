import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';
import { BashTool } from './bash.js';
import { GlobTool, GrepTool, LSTool } from './search.js';
import { WebFetchTool, TodoWriteTool } from './misc.js';

export const TOOLS = [BashTool, GlobTool, GrepTool, LSTool, ReadTool, EditTool, WriteTool, WebFetchTool, TodoWriteTool];

export const getTool = (name) => TOOLS.find((t) => t.name === name);

/** Tool definitions in the shape LLM APIs expect (for when a real provider is plugged in). */
export const toolSchemas = () =>
  TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
