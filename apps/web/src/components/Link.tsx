import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate } from '../lib/navigation'

export function Link({ href = '/', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return
    event.preventDefault()
    navigate(href)
  }
  return <a {...props} href={href} onClick={click} />
}
