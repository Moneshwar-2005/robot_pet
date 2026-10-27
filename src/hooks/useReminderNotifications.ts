/**
 * React Hook for Kuro Reminder Notifications
 *
 * Scope: Phase 4.4 + Phase 5
 *
 * Coordinates Web Notifications with in-app alert fallbacks, user-initiated permission,
 * and duplicate alert prevention.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Reminder } from '../types';
import {
  type NotificationPermissionStatus,
  type ReminderNotificationAlert,
  getNotificationPermission,
  requestNotificationPermission as requestPerm,
  checkRemindersToNotify,
  dispatchReminderNotification,
} from '../lib/notifications';

export interface UseReminderNotificationsReturn {
  permission: NotificationPermissionStatus;
  isSupported: boolean;
  requestPermission: () => Promise<NotificationPermissionStatus>;
  alerts: ReminderNotificationAlert[];
  dismissAlert: (alertId: string) => void;
  acknowledgeAlert: (reminderId: string) => void;
  testNotification: () => void;
}

export function useReminderNotifications(
  reminders: Reminder[],
  onToggleReminder?: (reminderId: string) => void
): UseReminderNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermissionStatus>(() =>
    getNotificationPermission()
  );
  const [alerts, setAlerts] = useState<ReminderNotificationAlert[]>([]);
  const isMountedRef = useRef(true);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSupported = permission !== 'unsupported';

  // Explicit user action to request notification permission
  const requestPermission = useCallback(async (): Promise<NotificationPermissionStatus> => {
    const nextPerm = await requestPerm();
    if (isMountedRef.current) {
      setPermission(nextPerm);
    }
    return nextPerm;
  }, []);

  const dismissAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, []);

  const acknowledgeAlert = useCallback(
    (reminderId: string) => {
      setAlerts((prev) => prev.filter((a) => a.reminderId !== reminderId));
      if (onToggleReminder) {
        onToggleReminder(reminderId);
      }
    },
    [onToggleReminder]
  );

  const testNotification = useCallback(() => {
    const testReminder: Reminder = {
      id: `test-${Date.now()}`,
      title: 'Kuro Test Notification: Ready for your focus session!',
      time: new Date().toISOString(),
      type: 'wellness',
      priority: 'normal',
      done: false,
    };

    dispatchReminderNotification(testReminder, (alert) => {
      if (isMountedRef.current) {
        setAlerts((prev) => [alert, ...prev.slice(0, 4)]);
      }
    });
  }, []);

  // Periodic scheduler: evaluates reminders every 15 seconds safely
  useEffect(() => {
    isMountedRef.current = true;

    const checkDueReminders = () => {
      if (!isMountedRef.current || reminders.length === 0) return;

      const due = checkRemindersToNotify(reminders);
      for (const item of due) {
        dispatchReminderNotification(item, (alert) => {
          if (isMountedRef.current) {
            setAlerts((prev) => {
              // Avoid duplicate in-app alerts for same reminder
              if (prev.some((a) => a.reminderId === alert.reminderId)) {
                return prev;
              }
              return [alert, ...prev.slice(0, 4)];
            });
          }
        });
      }
    };

    // Immediate check on mount/reminders update
    checkDueReminders();

    // Single interval timer
    checkTimerRef.current = setInterval(checkDueReminders, 15000);

    return () => {
      isMountedRef.current = false;
      if (checkTimerRef.current) {
        clearInterval(checkTimerRef.current);
        checkTimerRef.current = null;
      }
    };
  }, [reminders]);

  return {
    permission,
    isSupported,
    requestPermission,
    alerts,
    dismissAlert,
    acknowledgeAlert,
    testNotification,
  };
}
