#!/usr/bin/env node
import { createFilteredStdin, setScrollCallback, disableMouse } from './mouse.js';

const filteredStdin = createFilteredStdin();
let scrollHandler: ((dir: 'up' | 'down') => void) | null = null;
setScrollCallback((dir) => { scrollHandler?.(dir); });

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { ChatGPTClient, type ChatEvent } from './client.js';

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

let nextId = 0;
const SCROLL_STEP = 3;

function countLines(text: string, width: number): number {
  let total = 0;
  for (const line of text.split('\n')) {
    total += Math.max(1, Math.ceil((line.length || 1) / width));
  }
  return total;
}

function MessageRow({ msg, width }: { msg: Message; width: number }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <Box paddingX={1}>
        <Text dimColor italic>{msg.content}</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} flexDirection="column">
      <Text bold color={isUser ? 'cyan' : 'green'}>
        {isUser ? ' You' : ' ChatGPT'}
      </Text>
      <Box paddingLeft={2} marginBottom={1}>
        <Text>{msg.content}</Text>
      </Box>
    </Box>
  );
}

function Scrollbar({ height, totalLines, viewportTop, viewportHeight }: {
  height: number;
  totalLines: number;
  viewportTop: number;
  viewportHeight: number;
}) {
  if (totalLines <= viewportHeight || height <= 0) {
    return (
      <Box flexDirection="column" width={1}>
        {Array.from({ length: height }, (_, i) => (
          <Text key={i} dimColor> </Text>
        ))}
      </Box>
    );
  }

  const thumbSize = Math.max(1, Math.round((viewportHeight / totalLines) * height));
  const scrollRange = totalLines - viewportHeight;
  const trackRange = height - thumbSize;
  const thumbPos = scrollRange > 0
    ? Math.round((viewportTop / scrollRange) * trackRange)
    : 0;

  const track: string[] = [];
  for (let i = 0; i < height; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      track.push('┃');
    } else {
      track.push('│');
    }
  }

  return (
    <Box flexDirection="column" width={1}>
      {track.map((ch, i) => (
        <Text key={i} color={ch === '┃' ? 'cyan' : 'gray'}>{ch}</Text>
      ))}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [client, setClient] = useState<ChatGPTClient | null>(null);
  const [status, setStatus] = useState<'init' | 'ready' | 'error'>('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const userScrolled = useRef(false);

  useEffect(() => {
    const onResize = () => {
      setRows(stdout?.rows ?? 24);
      setCols(stdout?.columns ?? 80);
    };
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);

  useEffect(() => {
    scrollHandler = (dir) => {
      if (dir === 'up') {
        userScrolled.current = true;
        setScrollOffset(prev => prev + SCROLL_STEP);
      } else {
        setScrollOffset(prev => {
          const next = Math.max(0, prev - SCROLL_STEP);
          if (next === 0) userScrolled.current = false;
          return next;
        });
      }
    };
    return () => { scrollHandler = null; };
  }, []);

  useEffect(() => {
    const c = new ChatGPTClient();
    c.init()
      .then(() => {
        setClient(c);
        setStatus('ready');
      })
      .catch((err: Error) => {
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      exit();
    }
    if (key.upArrow) {
      userScrolled.current = true;
      setScrollOffset(prev => prev + SCROLL_STEP);
    }
    if (key.downArrow) {
      setScrollOffset(prev => {
        const next = Math.max(0, prev - SCROLL_STEP);
        if (next === 0) userScrolled.current = false;
        return next;
      });
    }
  });

  useEffect(() => {
    if (!userScrolled.current) {
      setScrollOffset(0);
    }
  }, [messages.length]);

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming || !client) return;

    if (trimmed === '/quit' || trimmed === '/exit') {
      exit();
      return;
    }
    if (trimmed === '/help') {
      setMessages(prev => [...prev, {
        id: nextId++,
        role: 'system',
        content: [
          '/new       Start a new conversation',
          '/help      Show this help message',
          '/quit      Exit ChatTerm',
          'Esc        Exit ChatTerm',
          'Scroll/↑↓  Scroll messages',
        ].join('\n'),
      }]);
      setInput('');
      return;
    }
    if (trimmed === '/new') {
      client.reset();
      setMessages(prev => [...prev, {
        id: nextId++,
        role: 'system',
        content: '— New conversation —',
      }]);
      setInput('');
      return;
    }

    setInput('');
    userScrolled.current = false;
    setScrollOffset(0);
    const userMsg: Message = { id: nextId++, role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamContent('');

    try {
      let fullText = '';
      for await (const event of client.chat(trimmed)) {
        if (event.type === 'token' && event.text) {
          fullText += event.text;
          setStreamContent(fullText);
        } else if (event.type === 'error') {
          setMessages(prev => [...prev, {
            id: nextId++,
            role: 'system',
            content: `Error: ${event.error}`,
          }]);
          break;
        }
      }
      if (fullText) {
        setMessages(prev => [...prev, {
          id: nextId++,
          role: 'assistant',
          content: fullText,
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: nextId++,
        role: 'system',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    } finally {
      setStreaming(false);
      setStreamContent('');
    }
  }, [client, streaming, exit]);

  const messageAreaHeight = rows - 8;
  const innerWidth = cols - 7;

  const { visibleMessages, totalLines, viewportTop } = useMemo(() => {
    const allItems: { type: 'msg' | 'streaming'; msg?: Message; text?: string; lines: number }[] = [];

    for (const msg of messages) {
      const labelLine = 1;
      const contentLines = msg.role === 'system'
        ? countLines(msg.content, innerWidth)
        : countLines(msg.content, innerWidth - 2) + labelLine + 1;
      allItems.push({ type: 'msg', msg, lines: contentLines });
    }

    if (streaming && streamContent) {
      const lines = countLines(streamContent, innerWidth - 2) + 1 + 1;
      allItems.push({ type: 'streaming', text: streamContent, lines });
    } else if (streaming) {
      allItems.push({ type: 'streaming', lines: 1 });
    }

    const totalLines = allItems.reduce((sum, it) => sum + it.lines, 0);

    let skipLines = scrollOffset;
    let endIdx = allItems.length;
    while (skipLines > 0 && endIdx > 0) {
      endIdx--;
      skipLines -= allItems[endIdx]!.lines;
    }

    let available = messageAreaHeight;
    let startIdx = endIdx;
    while (startIdx > 0 && available > 0) {
      startIdx--;
      available -= allItems[startIdx]!.lines;
    }
    if (available < 0) startIdx++;

    let topLines = 0;
    for (let i = 0; i < startIdx; i++) topLines += allItems[i]!.lines;

    return {
      visibleMessages: allItems.slice(startIdx, endIdx || allItems.length),
      totalLines,
      viewportTop: topLines,
    };
  }, [messages, streaming, streamContent, messageAreaHeight, innerWidth, scrollOffset]);

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={cols}
      borderStyle="round"
      borderColor="gray"
    >
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">ChatTerm</Text>
        <Text dimColor>
          {status === 'init' ? '' : '/help'}
        </Text>
      </Box>

      <Box height={0} borderStyle="single" borderColor="gray" borderTop={false} borderLeft={false} borderRight={false} />

      <Box flexGrow={1} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingTop={1}>
          {status === 'init' && (
            <Box paddingX={2} gap={1}>
              <Text color="cyan"><Spinner type="dots" /></Text>
              <Text>Connecting to ChatGPT...</Text>
            </Box>
          )}

          {status === 'error' && (
            <Box paddingX={2}>
              <Text color="red">Failed to connect: {errorMsg}</Text>
            </Box>
          )}

          {status === 'ready' && messages.length === 0 && !streaming && (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
              <Text dimColor>Send a message to start chatting</Text>
            </Box>
          )}

          {status === 'ready' && visibleMessages.map((item, i) => {
            if (item.type === 'msg' && item.msg) {
              return <MessageRow key={`msg-${item.msg.id}`} msg={item.msg} width={innerWidth} />;
            }
            if (item.type === 'streaming' && item.text) {
              return (
                <Box key="streaming" paddingX={1} flexDirection="column">
                  <Text bold color="green">{' '}ChatGPT</Text>
                  <Box paddingLeft={2}>
                    <Text>{item.text}<Text color="gray">{'▌'}</Text></Text>
                  </Box>
                </Box>
              );
            }
            if (item.type === 'streaming') {
              return (
                <Box key="thinking" paddingX={2} gap={1}>
                  <Text color="green"><Spinner type="dots" /></Text>
                  <Text dimColor>Thinking...</Text>
                </Box>
              );
            }
            return null;
          })}
        </Box>

        <Scrollbar
          height={messageAreaHeight}
          totalLines={totalLines}
          viewportTop={viewportTop}
          viewportHeight={messageAreaHeight}
        />
      </Box>

      {scrollOffset > 0 && (
        <Box justifyContent="center">
          <Text dimColor>↓ scroll down to return to latest ↓</Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Box
          borderStyle="round"
          borderColor={streaming ? 'gray' : 'white'}
          paddingX={1}
          width="100%"
        >
          <Text bold color="cyan">{'❯ '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={streaming ? 'Waiting for response...' : 'Type a message...'}
            focus={!streaming}
          />
        </Box>
      </Box>
    </Box>
  );
}

const app = render(<App />, {
  exitOnCtrlC: true,
  stdin: filteredStdin as unknown as NodeJS.ReadStream,
});
app.waitUntilExit().then(() => disableMouse());
