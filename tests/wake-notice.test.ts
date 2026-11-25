import { describe, expect, it } from 'vitest';
import {
  GUEST_WAKE_NOTICE,
  LEGACY_GUEST_WAKE_NOTICE,
  LEGACY_REVIEW_NEEDED_NOTICE,
  REVIEW_NEEDED_NOTICE,
  WAKE_NOTICE,
  guestTaskWakeNotice,
  messageWakeNotice,
  reviewNeededWakeNotice,
  taskThreadMessageWakeNotice,
  taskWakeNotice,
  wakePaneNotice,
} from '@/lib/wake-notice';
import { nudgeText, type DueWake } from '../packages/cli/src/watch';

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

/** CLI 0.1.5 nudgeText: maps pre-rename poll constants to Valetto wording, ignores unknown fields. */
function nudgeText015(wake: { notice?: string }): string {
  if (wake.notice === GUEST_WAKE_NOTICE || wake.notice === LEGACY_GUEST_WAKE_NOTICE) return GUEST_WAKE_NOTICE;
  if (wake.notice === REVIEW_NEEDED_NOTICE || wake.notice === LEGACY_REVIEW_NEEDED_NOTICE) return REVIEW_NEEDED_NOTICE;
  return WAKE_NOTICE;
}

/** CLI 0.1.4 nudgeText: only the pre-rename constants, types the pre-rename wording. */
const REPLYSLIP_WAKE_NOTICE = 'Another agent sent you something on ReplySlip; check it with your ReplySlip tools.';
function nudgeText014(wake: { notice?: string }): string {
  if (wake.notice === LEGACY_GUEST_WAKE_NOTICE) return LEGACY_GUEST_WAKE_NOTICE;
  if (wake.notice === LEGACY_REVIEW_NEEDED_NOTICE) return LEGACY_REVIEW_NEEDED_NOTICE;
  return REPLYSLIP_WAKE_NOTICE;
}

describe('wakePaneNotice', () => {
  it('names the kind of wake and its id, and never a body', () => {
    expect(wakePaneNotice({ reason: 'message', messageId: MESSAGE_ID })).toBe(messageWakeNotice(MESSAGE_ID));
    expect(messageWakeNotice(MESSAGE_ID)).toContain(MESSAGE_ID);
    expect(messageWakeNotice(MESSAGE_ID)).toContain('in_reply_to');
    expect(wakePaneNotice({ reason: 'message', messageId: MESSAGE_ID, taskId: TASK_ID })).toBe(
      taskThreadMessageWakeNotice(MESSAGE_ID, TASK_ID),
    );
    expect(wakePaneNotice({ reason: 'task', taskId: TASK_ID })).toBe(taskWakeNotice(TASK_ID, 'task'));
    expect(taskWakeNotice(TASK_ID, 'task')).toContain('get_task');
    expect(wakePaneNotice({ reason: 'result', taskId: TASK_ID })).toContain('result');
    expect(wakePaneNotice({ reason: 'question', taskId: TASK_ID })).toContain('answer_task');
    expect(wakePaneNotice({ reason: 'review_needed', taskId: TASK_ID })).toBe(reviewNeededWakeNotice(TASK_ID));
    expect(wakePaneNotice({ reason: 'task', taskId: TASK_ID, guest: true })).toBe(guestTaskWakeNotice(TASK_ID));
    expect(guestTaskWakeNotice(TASK_ID)).toContain('untrusted');
    expect(wakePaneNotice({ reason: 'test' })).toBe(WAKE_NOTICE);
    for (const text of [
      messageWakeNotice(MESSAGE_ID),
      taskWakeNotice(TASK_ID, 'task'),
      guestTaskWakeNotice(TASK_ID),
      reviewNeededWakeNotice(TASK_ID),
    ]) {
      expect(text).not.toMatch(/CANARY|secret|@/);
    }
  });
});

describe('nudgeText ids and older CLIs', () => {
  const messageWake: DueWake = { id: 'w1', reason: 'message', message_id: MESSAGE_ID, task_id: null };
  const taskWake: DueWake = { id: 'w2', reason: 'task', task_id: TASK_ID, message_id: null };
  const guestWake: DueWake = {
    id: 'w3',
    reason: 'task',
    task_id: TASK_ID,
    message_id: null,
    notice: LEGACY_GUEST_WAKE_NOTICE,
  };
  const reviewWake: DueWake = {
    id: 'w4',
    reason: 'review_needed',
    task_id: TASK_ID,
    message_id: null,
    notice: LEGACY_REVIEW_NEEDED_NOTICE,
  };

  it('types ids on a current CLI, and falls back when an older server omits message_id', () => {
    expect(nudgeText(messageWake)).toBe(messageWakeNotice(MESSAGE_ID));
    expect(nudgeText(messageWake)).toContain(
      'Read it with get_message using message_id as id. If get_message is unavailable, use list_messages and match the ID.',
    );
    expect(nudgeText({ ...messageWake, task_id: TASK_ID })).toBe(taskThreadMessageWakeNotice(MESSAGE_ID, TASK_ID));
    expect(nudgeText(taskWake)).toBe(taskWakeNotice(TASK_ID, 'task'));
    expect(nudgeText(guestWake)).toBe(guestTaskWakeNotice(TASK_ID));
    expect(nudgeText(reviewWake)).toBe(reviewNeededWakeNotice(TASK_ID));
    expect(nudgeText({ id: 'old-server-message', reason: 'message' })).toBe(WAKE_NOTICE);
    expect(nudgeText({ id: 'old-server-guest', notice: LEGACY_GUEST_WAKE_NOTICE })).toBe(GUEST_WAKE_NOTICE);
    expect(nudgeText({ id: 'old-server-review', notice: LEGACY_REVIEW_NEEDED_NOTICE })).toBe(REVIEW_NEEDED_NOTICE);
  });

  it('keeps CLI 0.1.4 and 0.1.5 typing their fixed notices on a current poll payload', () => {
    for (const wake of [messageWake, taskWake]) {
      expect(nudgeText014(wake)).toBe(REPLYSLIP_WAKE_NOTICE);
      expect(nudgeText015(wake)).toBe(WAKE_NOTICE);
    }
    expect(nudgeText014(guestWake)).toBe(LEGACY_GUEST_WAKE_NOTICE);
    expect(nudgeText015(guestWake)).toBe(GUEST_WAKE_NOTICE);
    expect(nudgeText014(reviewWake)).toBe(LEGACY_REVIEW_NEEDED_NOTICE);
    expect(nudgeText015(reviewWake)).toBe(REVIEW_NEEDED_NOTICE);
  });
});
