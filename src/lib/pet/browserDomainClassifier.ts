/**
 * Kuro Robot Companion — Browser Domain Classifier & Privacy Filter
 *
 * Scope: Phase 7.4 Context Awareness & Least-Privilege Browser Integration
 *
 * PRIVACY GUARANTEES:
 * 1. Only processes sanitized domain/hostname and optional top-level page title.
 * 2. Zero page DOM access, zero form fields, zero passwords, zero keystrokes.
 * 3. Never tracks URL query strings, search parameters, or credentials.
 * 4. Automatic exclusion of localhost, banking/financial, and authentication domains.
 * 5. Strict user opt-in: browser tracking is disabled by default.
 */

import type { BrowserDomainCategory } from '../../types';

// Built-in list of domains that are automatically excluded for privacy & security
export const DEFAULT_EXCLUDED_PATTERNS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'accounts.google.com',
  'login.',
  'auth.',
  'signin.',
  'sso.',
  'paypal.com',
  'stripe.com',
  'bank',
  'chase.com',
  'wellsfargo.com',
  'citi.com',
  'hdfcbank.com',
  'icicibank.com',
  'sbi.co.in',
  'passwords.',
  'bitwarden.com',
  '1password.com',
  'lastpass.com',
];

export interface ClassifiedDomain {
  hostname: string;
  category: BrowserDomainCategory;
  isExcluded: boolean;
  cleanTitle?: string;
}

/**
 * Normalizes and strips unwanted prefixes (like "www." or port numbers).
 */
export function normalizeHostname(rawInput: string | null | undefined): string {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let clean = rawInput.trim().toLowerCase();

  // If a full URL was accidentally passed, extract just the hostname
  if (clean.includes('://')) {
    try {
      const parsed = new URL(clean);
      clean = parsed.hostname;
    } catch {
      clean = clean.split('://')[1]?.split('/')[0]?.split('?')[0] || '';
    }
  }

  // Strip port if present
  clean = clean.split(':')[0] || '';
  // Strip trailing slashes
  clean = clean.replace(/\/+$/, '');
  // Strip www. prefix
  if (clean.startsWith('www.')) {
    clean = clean.slice(4);
  }

  return clean;
}

/**
 * Checks if a hostname matches any excluded pattern or user-defined blacklist.
 */
export function isDomainExcluded(
  hostname: string,
  userExclusions: readonly string[] = []
): boolean {
  const norm = normalizeHostname(hostname);
  if (!norm) return true;

  // Check built-in safety exclusions
  for (const pattern of DEFAULT_EXCLUDED_PATTERNS) {
    if (norm.includes(pattern)) return true;
  }

  // Check user exclusions
  for (const exclusion of userExclusions) {
    const cleanExclusion = normalizeHostname(exclusion);
    if (cleanExclusion && norm.includes(cleanExclusion)) {
      return true;
    }
  }

  return false;
}

/**
 * Categorizes a domain into a predefined Kuro context bucket.
 */
export function classifyDomain(
  rawHostname: string,
  userExclusions: readonly string[] = []
): BrowserDomainCategory {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname || isDomainExcluded(hostname, userExclusions)) {
    return 'private_excluded';
  }

  // 1. Coding & Development
  if (
    hostname.includes('github.com') ||
    hostname.includes('gitlab.com') ||
    hostname.includes('bitbucket.org') ||
    hostname.includes('npmjs.com') ||
    hostname.includes('pypi.org') ||
    hostname.includes('stackoverflow.com') ||
    hostname.includes('codepen.io') ||
    hostname.includes('replit.com') ||
    hostname.includes('huggingface.co') ||
    hostname.includes('leetcode.com') ||
    hostname.includes('hackerrank.com')
  ) {
    return 'coding';
  }

  // 2. Documentation & Technical References
  if (
    hostname.startsWith('docs.') ||
    hostname.includes('developer.mozilla.org') ||
    hostname.includes('react.dev') ||
    hostname.includes('angular.dev') ||
    hostname.includes('vuejs.org') ||
    hostname.includes('typescriptlang.org') ||
    hostname.includes('python.org') ||
    hostname.includes('rust-lang.org') ||
    hostname.includes('pkg.go.dev') ||
    hostname.includes('crates.io') ||
    hostname.includes('vite.dev') ||
    hostname.includes('tailwindcss.com') ||
    hostname.includes('supabase.com/docs')
  ) {
    return 'documentation';
  }

  // 3. Work & Project Management
  if (
    hostname.includes('notion.so') ||
    hostname.includes('linear.app') ||
    hostname.includes('trello.com') ||
    hostname.includes('asana.com') ||
    hostname.includes('figma.com') ||
    hostname.includes('docs.google.com') ||
    hostname.includes('sheets.google.com') ||
    hostname.includes('jira.') ||
    hostname.includes('confluence.') ||
    hostname.includes('miro.com')
  ) {
    return 'work';
  }

  // 4. Learning & Academic
  if (
    hostname.includes('coursera.org') ||
    hostname.includes('edx.org') ||
    hostname.includes('udemy.com') ||
    hostname.includes('arxiv.org') ||
    hostname.includes('wikipedia.org') ||
    hostname.includes('khanacademy.org') ||
    hostname.includes('freecodecamp.org') ||
    hostname.includes('medium.com') ||
    hostname.includes('dev.to')
  ) {
    return 'learning';
  }

  // 5. Communication
  if (
    hostname.includes('slack.com') ||
    hostname.includes('discord.com') ||
    hostname.includes('mail.google.com') ||
    hostname.includes('outlook.live.com') ||
    hostname.includes('outlook.office.com') ||
    hostname.includes('teams.microsoft.com') ||
    hostname.includes('zoom.us')
  ) {
    return 'communication';
  }

  // 6. Entertainment & Social Media
  if (
    hostname.includes('youtube.com') ||
    hostname.includes('netflix.com') ||
    hostname.includes('twitch.tv') ||
    hostname.includes('reddit.com') ||
    hostname.includes('x.com') ||
    hostname.includes('twitter.com') ||
    hostname.includes('instagram.com') ||
    hostname.includes('spotify.com')
  ) {
    return 'entertainment';
  }

  return 'work';
}

/**
 * Sanitizes and caps browser tab title length to prevent UI overflow or information leakage.
 * Strips URLs, tokens/parameters, and email addresses.
 */
export function sanitizeBrowserTitle(title: string | null | undefined, maxLen = 60): string {
  if (!title || typeof title !== 'string') return '';
  let cleaned = title.trim();

  // Strip URLs (e.g. https://... or http://...)
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();

  // Strip email addresses (e.g. user@example.com)
  cleaned = cleaned.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '').trim();

  // Normalize excessive spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3).trimEnd() + '...';
}
