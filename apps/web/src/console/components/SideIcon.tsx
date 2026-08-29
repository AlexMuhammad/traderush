/**
 * UP / DOWN, as a moulded arrow rather than an emoji.
 *
 *  Emoji render differently on every platform and carry a whole illustration
 *  where a direction is all that is meant. These are two triangles with the
 *  side's own colour and a light edge beneath, so they read as part of the key
 *  cap — and they keep their colour when the lamp comes on, because the colour
 *  IS the information.
 */
export function SideIcon({ side }: { side: 'up' | 'down' }) {
  const up = side === 'up';
  return (
    <svg className="sideicon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={up ? 'M12 4l9 15H3z' : 'M12 20L3 5h18z'}
        fill={up ? '#1E9E5F' : '#C4352A'}
      />
    </svg>
  );
}
