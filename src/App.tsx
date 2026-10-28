import { useMemo, useRef, useState } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { books as builtInBooks, type Book, type Question } from './data';

type ImportRow = { context: string; target: string; meaning: string; category: string };
type Option = { text: string; correct: boolean };
const STORAGE_KEY = 'daily-homework-imported-books-v1';
const letters = ['A', 'B', 'C', 'D'];

function readSavedBooks(): Book[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value as Book[] : [];
  } catch {
    return [];
  }
}

function cleanPdfLine(value: string) {
  return value.replace(/[＿_﹏﹣—·•]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferTarget(line: string) {
  const categoryLabel = /(?:古义|今义|通假字|词义|释义|解释)\s*[：:]?/;
  const clean = line.replace(/^[（(]?[0-9０-９一二三四五六七八九十]+[）)、.．、]?\s*/, '');
  if (categoryLabel.test(clean)) return '';
  const colonLabel = clean.match(/^([^：:]{1,10})[：:]/);
  if (colonLabel) return colonLabel[1].trim();
  return '';
}

async function extractPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line.trim()) lines.push(line);
  }
  const start = lines.findIndex((line) => /词语解释/.test(line));
  if (start < 0) throw new Error('没有找到“词语解释”部分。请确认 PDF 中包含可选择的文字。');
  const endAt = lines.findIndex((line, index) => index > start && /句子翻译|对比阅读/.test(line));
  const section = lines.slice(start + 1, endAt < 0 ? lines.length : endAt);
  const ignored = /^(?:[一二三四五六七八九十0-9０-９]+[、.．)）]\s*(?:词语解释|句子翻译|文学常识|对比阅读)|通假字\s*$|古今异义\s*$|一词多义\s*$|词类活用\s*$|重点字词\s*$|满分|每空|\d+分)/;
  const rows: ImportRow[] = [];
  let activeCategory = '重点字词';
  for (const raw of section) {
    const line = cleanPdfLine(raw);
    if (!line || ignored.test(line) || line.length < 2 || /^\d+$/.test(line)) continue;
    const categoryLabel = line.match(/(?:通假字|古今异义|一词多义|词类活用|重点字词)/)?.[0];
    if (categoryLabel) activeCategory = categoryLabel;
    const category = activeCategory;
    const context = line.replace(/^[（(]?[0-9０-９一二三四五六七八九十]+[）)、.．、]?\s*/, '').replace(/^(?:通假字|古今异义|一词多义|词类活用|重点字词)\s*/, '').replace(/\s*(?:古义|今义)\s*[：:]?.*$/, '').trim();
    if (!context || /^(古义|今义)$/.test(context)) continue;
    rows.push({ context, target: inferTarget(line), meaning: '', category });
  }
  const unique = rows.filter((row, index) => rows.findIndex((other) => other.context === row.context && other.category === row.category) === index);
  if (!unique.length) throw new Error('找到了词语解释部分，但没有识别出可编辑的题目。');
  return unique;
}

function makeOptions(book: Book, question: Question): Option[] {
  const answer = question[3];
  const others = [...new Set(book.questions.map((entry) => entry[3]).filter((text) => text && text !== answer))];
  for (let i = others.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const options = [{ text: answer, correct: true }, ...others.slice(0, 3).map((text) => ({ text, correct: false }))];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export default function App() {
  const [customBooks, setCustomBooks] = useState<Book[]>(readSavedBooks);
  const allBooks = useMemo(() => [...builtInBooks, ...customBooks], [customBooks]);
  const [bookIndex, setBookIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [options, setOptions] = useState<Option[]>([]);
  const [selection, setSelection] = useState<Option | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<number, boolean>>({});
  const [responses, setResponses] = useState<Record<number, { text: string; correct: boolean }>>({});
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const book = allBooks[bookIndex];
  const question = book?.questions[questionIndex];

  function resetQuiz(index: number) {
    setBookIndex(index);
    setQuestionIndex(0);
    setSelection(null);
    setOptions([]);
    setRevealed(false);
    setResults({});
    setResponses({});
  }

  function chooseOption(option: Option) {
    if (selection) return;
    setSelection(option);
    setResults((previous) => ({ ...previous, [questionIndex]: option.correct }));
    setResponses((previous) => ({ ...previous, [questionIndex]: { text: option.text, correct: option.correct } }));
  }

  function goToQuestion(index: number) {
    const targetQuestion = book.questions[index];
    const nextOptions = makeOptions(book, targetQuestion);
    const savedResponse = responses[index];
    setQuestionIndex(index);
    setOptions(nextOptions);
    setSelection(savedResponse ? nextOptions.find((option) => option.text === savedResponse.text) ?? savedResponse : null);
    setRevealed(Boolean(savedResponse) && new Set(book.questions.map((entry) => entry[3])).size < 4);
  }

  function markStudyAnswer(correct: boolean) {
    const response = { text: question?.[3] ?? '', correct };
    setSelection(response);
    setResults((previous) => ({ ...previous, [questionIndex]: correct }));
    setResponses((previous) => ({ ...previous, [questionIndex]: response }));
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setNotice('');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setNotice('请选择 PDF 文件。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setNotice('文件不能超过 20 MB。');
      return;
    }
    setBusy(true);
    try {
      const rows = await extractPdf(file);
      setImportRows(rows);
      setImportTitle(file.name.replace(/\.pdf$/i, '').replace(/[（(].*$/, '') || '新课文');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PDF 读取失败，请换一个文件重试。');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function updateRow(index: number, key: keyof ImportRow, value: string) {
    setImportRows((rows) => rows?.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) ?? null);
  }

  function addImportRow() {
    setImportRows((rows) => rows ? [...rows, { context: '', target: '', meaning: '', category: '重点字词' }] : null);
  }

  function removeImportRow(index: number) {
    setImportRows((rows) => rows ? rows.filter((_, rowIndex) => rowIndex !== index) : null);
  }

  function saveImport() {
    if (!importRows?.length) return;
    const questions = importRows.map((row) => [row.context, row.target, row.category, row.meaning, '其他意思', '请再想一想', '暂未填写'] as Question);
    const added: Book = { title: `《${importTitle.trim() || '新课文'}》`, questions };
    const updated = [...customBooks, added];
    setCustomBooks(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setImportRows(null);
    resetQuiz(allBooks.length);
    setNotice(`已加入《${importTitle.trim() || '新课文'}》，共 ${questions.length} 道题。`);
  }

  function deleteBook(index: number) {
    const customIndex = index - builtInBooks.length;
    const updated = customBooks.filter((_, i) => i !== customIndex);
    setCustomBooks(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    resetQuiz(0);
  }

  const complete = Boolean(book && questionIndex >= book.questions.length);
  const score = Object.values(results).filter(Boolean).length;
  const needsStudyMode = Boolean(question && new Set(book.questions.map((entry) => entry[3])).size < 4);
  const activeOptions = useMemo(() => options.length ? options : question ? makeOptions(book, question) : [], [options, book, question, questionIndex]);

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="文言词语小练习首页"><span className="brand-mark">文</span><span>文言词语小练习</span></a>
        <div className="topbar-right"><span className="top-note">每日积累 · 温故知新</span><button className="upload-button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? '正在读取…' : '＋ 上传 PDF'}</button></div>
      </header>
      <main className="shell">
        <section className="intro"><div><p className="eyebrow">DAILY CLASSICAL CHINESE</p><h1>把课文词义，练成长期记忆。</h1><p className="subheading">选择一篇课文开始练习，或上传新的词语解释 PDF。</p></div><div className="intro-decoration" aria-hidden="true"><span>山</span><span>水</span><span>记</span></div></section>
        <section className="workspace">
          <aside className="sidebar">
            <div className="side-heading"><div><p className="section-label">学习内容</p><h2>课文目录</h2></div><span className="book-total">{allBooks.length} 篇</span></div>
            <div className="book-list">{allBooks.map((item, index) => <div className={`book-row ${index === bookIndex ? 'selected' : ''}`} key={`${item.title}-${index}`}><button className="book-select" onClick={() => resetQuiz(index)}><span className="book-icon">{index < builtInBooks.length ? '文' : '＋'}</span><span className="book-info"><strong>{item.title}</strong><small>{item.questions.length} 道词义题</small></span><span className="row-chevron">›</span></button>{index >= builtInBooks.length && <button className="delete-book" onClick={() => deleteBook(index)} aria-label={`删除${item.title}`} title="删除导入课文">×</button>}</div>)}</div>
            <button className="import-card" onClick={() => inputRef.current?.click()} disabled={busy}><span className="upload-icon">↑</span><span><strong>{busy ? '正在读取 PDF…' : '导入新课文'}</strong><small>PDF · 最大 20 MB</small></span><span className="import-arrow">＋</span></button>
            <p className="privacy-note"><span>◈</span> PDF 在浏览器本地解析，不会上传到服务器。</p>
          </aside>
          <section className="practice-area">
            {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}
            {complete ? <div className="completion card"><div className="completion-icon">✓</div><p className="section-label">PRACTICE COMPLETE</p><h2>本篇练习完成</h2><p>答对 <strong>{score}</strong> / {book.questions.length} 题</p><button className="secondary-button" onClick={() => goToQuestion(book.questions.length - 1)}>返回上一题</button><button className="primary-button" onClick={() => resetQuiz(bookIndex)}>再练一次 <span>↻</span></button></div> : question && <>
              <div className="practice-heading"><div><p className="section-label">今日练习 · 词语解释</p><h2>{book.title}</h2></div><div className="question-count"><strong>{questionIndex + 1}</strong><span> / {book.questions.length}</span></div></div>
              <div className="progress-track"><span style={{ width: `${((questionIndex + 1) / book.questions.length) * 100}%` }} /></div>
              <article className="question-card">
                <div className="question-meta"><span className="category-pill"><i />{question[2]}</span><span className="question-index">题目 {String(questionIndex + 1).padStart(2, '0')}</span></div>
                <p className="sentence">{question[0].split(question[1].replace(/（.*?）/g, '')) .map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <mark>{question[1].replace(/（.*?）/g, '')}</mark>}</span>)}</p>
                <p className="source-line">选自 <span>{book.title}</span><b>›</b></p>
                <h3>句中「<span>{question[1]}</span>」的意思是？</h3>
                {needsStudyMode ? <div className="study-answer"><p>先想一想这个词的意思，再翻开卡片核对。</p>{revealed ? <div className="revealed-answer"><small>参考释义</small><strong>{question[3]}</strong>{!selection && <div className="self-check"><button onClick={() => markStudyAnswer(true)}>记住了</button><button onClick={() => markStudyAnswer(false)}>再复习</button></div>}</div> : <button className="reveal-button" onClick={() => setRevealed(true)}>显示释义 <span>↓</span></button>}</div> : <div className="options">{activeOptions.map((option, index) => <button className={`option ${selection && option.correct ? 'correct' : ''} ${selection === option && !option.correct ? 'wrong' : ''}`} key={`${option.text}-${index}`} onClick={() => chooseOption(option)} disabled={Boolean(selection)}><span className="option-letter">{letters[index]}</span><span>{option.text}</span>{selection && option.correct && <span className="result-mark">✓</span>}</button>)}</div>}
                {selection && <p className={`feedback ${results[questionIndex] ? 'good' : 'bad'}`}>{needsStudyMode ? (results[questionIndex] ? '太好了，这个词已经记住。' : `记下释义：${question[3]}`) : results[questionIndex] ? '答对了，继续保持！' : `再记一记：「${question[1]}」意思是${question[3]}。`}</p>}
                <div className="question-controls"><span className="keyboard-hint">读懂句子，选出目标词义</span><div className="control-actions"><button className="previous-button" onClick={() => goToQuestion(questionIndex - 1)} disabled={questionIndex === 0}>← 上一题</button><button className="next-button" onClick={() => goToQuestion(questionIndex + 1)} disabled={!selection}>{questionIndex === book.questions.length - 1 ? '查看结果' : '下一题'} <span>→</span></button></div></div>
              </article>
            </>}
          </section>
        </section>
        <footer className="site-footer"><span>文言词语小练习</span><span>专注积累 · 稳步进步</span></footer>
      </main>
      {importRows && <div className="modal-backdrop" role="presentation"><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-heading"><div className="modal-head"><div><p className="section-label">PDF IMPORT</p><h2 id="import-heading">检查并补充词语释义</h2></div><button className="modal-close" onClick={() => setImportRows(null)} aria-label="关闭">×</button></div><p className="modal-copy">我们从 PDF 的“词语解释”部分提取到 {importRows.length} 行。请检查词语，并补上原卷没有提供的标准释义，再加入练习。</p><label className="title-field">课文名称<input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="例如：桃花源记" /></label><div className="review-toolbar"><span>题目预览 / 编辑</span><button onClick={addImportRow}>＋ 添加词条</button></div><div className="review-table"><div className="review-header"><span>原文 / 题干</span><span>目标词</span><span>参考释义</span><span></span></div>{importRows.map((row, index) => <div className="review-row" key={`${index}-${row.context}`}><input aria-label={`第 ${index + 1} 题题干`} value={row.context} onChange={(event) => updateRow(index, 'context', event.target.value)} /><input aria-label={`第 ${index + 1} 题目标词`} value={row.target} placeholder="填写词语" onChange={(event) => updateRow(index, 'target', event.target.value)} /><input aria-label={`第 ${index + 1} 题释义`} value={row.meaning} placeholder="填写正确释义" onChange={(event) => updateRow(index, 'meaning', event.target.value)} /><button className="remove-row" onClick={() => removeImportRow(index)} aria-label={`移除第 ${index + 1} 题`}>×</button></div>)}</div><div className="modal-actions"><span>{importRows.length} 个词条 · 保存后仅保存在此浏览器</span><button className="primary-button" onClick={saveImport} disabled={!importRows.length || importRows.some((row) => !row.context.trim() || !row.target.trim() || !row.meaning.trim())}>加入练习 <span>→</span></button></div></section></div>}
      <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => handleFile(event.target.files?.[0])} />
    </>
  );
}
