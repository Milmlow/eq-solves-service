/**
 * Shared constants for the paste import flow.
 * Kept in a plain (non-server) module so they can be imported by both
 * the 'use server' actions file and the 'use client' page component.
 */

export const FREQUENCY_OPTIONS = [
  { value: 'monthly',     label: 'Monthly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-annual' },
  { value: 'annual',      label: 'Annual' },
  { value: '2yr',         label: '2 year' },
  { value: '3yr',         label: '3 year' },
  { value: '5yr',         label: '5 year' },
  { value: '6yr',         label: '6 year' },
  { value: '8yr',         label: '8 year' },
  { value: '10yr',        label: '10 year' },
] as const

export type FrequencyValue = typeof FREQUENCY_OPTIONS[number]['value']
