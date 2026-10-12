// Port of StringUtil.toBase37. 37^12 does not fit in a double, so this works in BigInt.
export function toBase37(s: string): bigint {
  let l = 0n
  for (let i = 0; i < s.length && i < 12; i++) {
    const c = s.charCodeAt(i)
    l *= 37n
    if (c >= 65 && c <= 90) l += BigInt(1 + c - 65)
    else if (c >= 97 && c <= 122) l += BigInt(1 + c - 97)
    else if (c >= 48 && c <= 57) l += BigInt(27 + c - 48)
  }
  while (l % 37n === 0n && l !== 0n) l /= 37n
  return l
}
