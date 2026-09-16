import { useCallback, useEffect, useState } from 'react'
import { useAccess } from '../../access/AccessContext'
import { readFavorites, toggleFavorite, writeFavorites } from './reportFavorites'

export interface ReportFavorites {
  favourites: ReadonlySet<string>
  isFavourite: (id: string) => boolean
  toggle: (id: string) => void
}

/**
 * The signed-in user's starred reports, kept in this browser.
 *
 * There is no server-side preference store in Inventory — the two preferences
 * it already has (pinned companies, column visibility) are both local — so a
 * star does not go and invent an API. It is scoped by member uuid, which
 * arrives a moment after the page mounts; the effect re-reads when it does, so
 * the stars fill in rather than being written away under an empty key.
 */
export function useReportFavorites(known: readonly string[]): ReportFavorites {
  const { member } = useAccess()
  const uuid = member?.uuid ?? null
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(() => new Set())

  // `known` is a module constant in practice; joining it keeps the effect from
  // re-running on every render if a caller ever passes a fresh array.
  const knownKey = known.join(',')
  useEffect(() => {
    setFavourites(readFavorites(uuid, knownKey ? knownKey.split(',') : []))
  }, [uuid, knownKey])

  const toggle = useCallback(
    (id: string) => {
      setFavourites((current) => {
        const next = toggleFavorite(current, id)
        writeFavorites(uuid, next)
        return next
      })
    },
    [uuid],
  )

  const isFavourite = useCallback((id: string) => favourites.has(id), [favourites])

  return { favourites, isFavourite, toggle }
}
