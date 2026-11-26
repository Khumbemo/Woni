/**
 * Mistake notebook, AI study-note cleaning, reminders and read-aloud text.
 */
import { describe, it, expect } from 'vitest';
import {
  CLEAR_AFTER, updateMistake, inNotebook, pickMistakes, cleanAiCards, cleanAiSummary, summaryText,
  parseTime, buildReminderIcs, nextReminderAt, questionSpeech, MAX_AI_CARDS,
} from '../studytools.js';

describe('mistake notebook', () => {
  it('records a mistake, then clears it after 2 right answers in a row', () => {
    let m = updateMistake(undefined, true);
    expect(m).toBeNull(); // never wrong: no record
    m = updateMistake(m, false, 100);
    expect(m).toEqual({ count: 1, lastWrong: 100, streak: 0 });
    expect(inNotebook({ mistake: m })).toBe(true);
    m = updateMistake(m, true);
    expect(inNotebook({ mistake: m })).toBe(true);
    m = updateMistake(m, false, 200); // wrong again: back to zero
    expect(m).toEqual({ count: 2, lastWrong: 200, streak: 0 });
    for (let i = 0; i < CLEAR_AFTER; i++) m = updateMistake(m, true);
    expect(inNotebook({ mistake: m })).toBe(false);
    expect(m.count).toBe(2); // history is kept
  });

  it('leaves out reported questions and orders by most missed, then most recent', () => {
    const q = (id, count, lastWrong, extra = {}) => ({ id, mistake: { count, lastWrong, streak: 0 }, ...extra });
    const picked = pickMistakes([q(1, 1, 50), q(2, 3, 10), q(3, 1, 90), q(4, 5, 1, { flagged: true }), { id: 5 }, q(6, 2, 5)]);
    expect(picked.map(x => x.id)).toEqual([2, 6, 3, 1]);
    expect(pickMistakes([], 10)).toEqual([]);
  });
});

describe('AI study notes', () => {
  it('cleans flashcards: trims, drops empty and repeated cards, caps the number', () => {
    const cards = cleanAiCards({ cards: [
      { front: ' What is ATP? ', back: ' Energy currency. ' },
      { front: 'what is  ATP?', back: 'dup' },
      { front: 'x', back: 'too short front' },
      { front: 'No back', back: '' },
      null, 'junk',
      ...Array.from({ length: 30 }, (_, i) => ({ front: `Card ${i}`, back: 'b' })),
    ] });
    expect(cards[0]).toEqual({ front: 'What is ATP?', back: 'Energy currency.' });
    expect(cards).toHaveLength(MAX_AI_CARDS);
    expect(cleanAiCards({})).toEqual([]);
    expect(cleanAiCards(null)).toEqual([]);
  });

  it('cleans a summary and turns it into text', () => {
    const s = cleanAiSummary({ title: 'Glycolysis', points: ['Net 2 ATP', '', 'Occurs in cytosol'], keyTerms: [{ term: 'PFK-1', meaning: 'Rate-limiting enzyme' }, { term: 'x' }] });
    expect(s).toEqual({ title: 'Glycolysis', points: ['Net 2 ATP', 'Occurs in cytosol'], keyTerms: [{ term: 'PFK-1', meaning: 'Rate-limiting enzyme' }] });
    expect(summaryText(s)).toBe('Glycolysis\n\n• Net 2 ATP\n• Occurs in cytosol\n\nKey terms\nPFK-1: Rate-limiting enzyme');
    expect(cleanAiSummary({ points: [] })).toBeNull();
    expect(cleanAiSummary({ points: ['One'] }).title).toBe('Revision summary');
  });
});

describe('reminders', () => {
  it('parses HH:MM times', () => {
    expect(parseTime('07:30')).toEqual({ h: 7, m: 30 });
    expect(parseTime('23:59')).toEqual({ h: 23, m: 59 });
    for (const bad of ['24:00', '7:30', '12:60', '', null, 'noon']) expect(parseTime(bad)).toBeNull();
  });

  it('builds a valid daily calendar event with an alert', () => {
    const now = new Date(2026, 10, 26, 10, 0).getTime();
    const ics = buildReminderIcs('18:45', { now });
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART:20261126T184500');
    expect(lines).toContain('DTEND:20261126T191000');
    expect(lines).toContain('RRULE:FREQ=DAILY');
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('TRIGGER:PT0M');
    expect(lines.filter(l => l.startsWith('BEGIN:')).length).toBe(lines.filter(l => l.startsWith('END:')).length);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines.find(l => l.startsWith('DESCRIPTION:Your'))).toContain("today's plan."); // commas escaped
    expect(lines.find(l => l.startsWith('DESCRIPTION:Your'))).toContain('daily challenge\\, flashcards');
    expect(buildReminderIcs('25:00')).toBeNull();
  });

  it('ends a late-evening reminder on the next day', () => {
    const ics = buildReminderIcs('23:50', { now: new Date(2026, 11, 31, 9).getTime() });
    expect(ics).toContain('DTSTART:20261231T235000');
    expect(ics).toContain('DTEND:20270101T001500');
  });

  it('finds the next reminder time', () => {
    const now = new Date(2026, 10, 26, 10, 0).getTime();
    expect(nextReminderAt('18:00', now)).toBe(new Date(2026, 10, 26, 18, 0).getTime());
    expect(nextReminderAt('09:00', now)).toBe(new Date(2026, 10, 27, 9, 0).getTime());
    expect(nextReminderAt('10:00', now)).toBe(new Date(2026, 10, 27, 10, 0).getTime());
    expect(nextReminderAt('bad', now)).toBeNull();
  });
});

describe('read aloud', () => {
  it('reads the question and then each option with its letter', () => {
    expect(questionSpeech({ text: 'Which enzyme unwinds DNA?', options: ['Primase', 'Helicase'] }))
      .toBe('Which enzyme unwinds DNA? Option A: Primase. Option B: Helicase.');
    expect(questionSpeech({})).toBe('');
  });
});
