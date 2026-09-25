/** When a digest came, as its page and the list show it: "Thu 24 Sep, 7:30 am". */
export function digestWhen(at: number): string {
  return new Date(at * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
