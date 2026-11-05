import { expect, test } from 'bun:test'
import { titleFromWords } from './storage'

test('a short first sentence is the title', () => {
  expect(titleFromWords('A dragon flew home. Then he slept.')).toBe('A dragon flew home')
})

test('"once upon a time" is dropped', () => {
  expect(titleFromWords('Once upon a time a fox found a hat.')).toBe('A fox found a hat')
})

test('a long sentence: the longest 5–8 word start that ends on a real word', () => {
  expect(titleFromWords('Once upon a time a purple dragon lived in a big castle on a hill.')).toBe(
    'A purple dragon lived in a big castle'
  )
  expect(titleFromWords('An owl sat in a tree under the stars and the moon.')).toBe('An owl sat in a tree')
  expect(titleFromWords('A little turtle swam in the blue sea with a happy pink fish.')).toBe(
    'A little turtle swam in the blue sea'
  )
})

test('never ends on a dangling word, and empty text has a fallback', () => {
  expect(titleFromWords('The cat and the')).toBe('The cat')
  expect(titleFromWords('')).toBe('Untitled story')
})
