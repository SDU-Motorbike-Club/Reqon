import { describe, expect, it } from 'vitest'
import { groupByOwner, holderText, isToolLocation, TOOL_LOCATION_LABEL, TOOL_LOCATIONS } from './toolModel.ts'

describe('tool location and holder', () => {
  it('has a label for every place and recognises only those', () => {
    for (const l of TOOL_LOCATIONS) expect(TOOL_LOCATION_LABEL[l]).toBeTruthy()
    expect(isToolLocation('home')).toBe(true)
    expect(isToolLocation('borrowed')).toBe(false) // borrowed is somebody having it, not a place
  })
  it('says who has it: nobody, you, or a name', () => {
    const names = new Map([['bo', 'Bo Wrench']])
    expect(holderText(null, names, 'me')).toBe('Nobody')
    expect(holderText('me', names, 'me')).toBe('You')
    expect(holderText('bo', names, 'me')).toBe('Bo Wrench')
    expect(holderText('gone', names, 'me')).toBe('Someone no longer on the roster')
  })
})

describe('groupByOwner', () => {
  const tool = (id: string, item: string, owner_id: string) => ({ id, item, owner_id })
  const names = new Map([['a', 'Ada'], ['b', 'Bo']])

  it('puts the signed-in member first, then the others by name', () => {
    const groups = groupByOwner([tool('1', 'Jack', 'b'), tool('2', 'Drill', 'a'), tool('3', 'Saw', 'me')], new Map([...names, ['me', 'Zed']]), 'me')
    expect(groups.map((g) => g.ownerId)).toEqual(['me', 'a', 'b'])
  })

  it('sorts a member\'s tools by name', () => {
    const [group] = groupByOwner([tool('1', 'Wrench', 'a'), tool('2', 'Clamp', 'a')], names, undefined)
    expect(group.tools.map((t) => t.item)).toEqual(['Clamp', 'Wrench'])
  })

  it('keeps a tool whose owner is not on the roster list', () => {
    const [group] = groupByOwner([tool('1', 'Vise', 'gone')], names, 'a')
    expect(group.name).toBe('Someone no longer on the roster')
  })

  it('gives nothing for no tools', () => {
    expect(groupByOwner([], names, 'a')).toEqual([])
  })
})
