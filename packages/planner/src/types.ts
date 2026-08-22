export type Conflict = {
  a: string
  b: string
  kind: 'meeting' | 'exam'
  day?: string
  date?: string
}
