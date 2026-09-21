import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeEntitiesOnce } from './entities'

test('decodes the named entities Spectora writes into names', () => {
  assert.equal(
    decodeEntitiesOnce('Basement, Foundation, Crawlspace &amp; Structure'),
    'Basement, Foundation, Crawlspace & Structure',
  )
  assert.equal(decodeEntitiesOnce('Doors &lt;here&gt;'), 'Doors <here>')
  assert.equal(decodeEntitiesOnce('It&apos;s &quot;fine&quot;'), 'It\'s "fine"')
})

test('decodes decimal and hexadecimal character references', () => {
  assert.equal(decodeEntitiesOnce('a&#13;&#10;b'), 'a\r\nb')
  assert.equal(decodeEntitiesOnce('&#x41;&#66;'), 'AB')
  assert.equal(decodeEntitiesOnce('space&#160;here'), 'space here')
})

test('decodes exactly one level, so a name containing literal "&amp;" survives', () => {
  // A triple-encoded value resolves one step per pass, never collapsing all
  // the way to "&" in a single decode.
  assert.equal(decodeEntitiesOnce('&amp;amp;'), '&amp;')
  assert.equal(decodeEntitiesOnce(decodeEntitiesOnce('&amp;amp;')), '&')
})

test('leaves values alone when there is nothing to decode', () => {
  assert.equal(decodeEntitiesOnce('Roof Drainage Systems'), 'Roof Drainage Systems')
  assert.equal(decodeEntitiesOnce('100% & rising'), '100% & rising')
  assert.equal(decodeEntitiesOnce(''), '')
})

test('leaves entities it does not recognise untouched rather than dropping them', () => {
  assert.equal(decodeEntitiesOnce('&hearts; &notanentity;'), '&hearts; &notanentity;')
  assert.equal(decodeEntitiesOnce('&#x110000;'), '&#x110000;')
})
