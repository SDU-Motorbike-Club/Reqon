import { describe, expect, it } from 'vitest'
import { groupByLocation, holderText, isToolLocation, toolKindLabel, toolMatches, TOOL_LOCATION_LABEL, TOOL_LOCATIONS } from './toolModel.ts'

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

describe('reading tools by place', () => {
  const t = (id: string, item: string, location: string) => ({ id, item, location })
  it('groups by place in a fixed order, name order inside, and skips empty places', () => {
    const groups = groupByLocation([t('1', 'Jack', 'university'), t('2', 'Wrench', 'workshop'), t('3', 'Awl', 'workshop')])
    expect(groups.map((g) => g.location)).toEqual(['workshop', 'university'])
    expect(groups[0].tools.map((x) => x.item)).toEqual(['Awl', 'Wrench'])
  })
  it('files a place this client does not know under somewhere else', () => {
    expect(groupByLocation([t('1', 'Odd', 'the moon')])[0].location).toBe('other')
  })
})

describe('whose a tool is', () => {
  const names = new Map([['bo', 'Bo Wrench']])
  it('says club tool, mine, or the owner\'s name', () => {
    expect(toolKindLabel({ shared: true, owner_id: 'bo' }, names, 'me')).toBe('Club tool')
    expect(toolKindLabel({ shared: false, owner_id: 'me' }, names, 'me')).toBe('Mine')
    expect(toolKindLabel({ shared: false, owner_id: 'bo' }, names, 'me')).toBe('Bo Wrench')
    expect(toolKindLabel({ shared: false, owner_id: 'gone' }, names, 'me')).toBe('Someone no longer on the roster')
  })
})

describe('finding a tool', () => {
  const names = new Map([['bo', 'Bo Wrench'], ['me', 'Ada Rider']])
  const jack = { item: 'Jack', location: 'workshop', owner_id: 'bo', held_by: null, shared: true }
  const wrench = { item: 'Torque wrench', location: 'home', owner_id: 'me', held_by: 'me', shared: false }
  const meter = { item: 'Multimeter', location: 'university', owner_id: 'bo', held_by: 'bo', shared: false }
  const all = [jack, wrench, meter]
  it('searches name, owner, holder, place and "club tool" without regard to case', () => {
    expect(all.filter((x) => toolMatches(x, 'TORQUE', names))).toEqual([wrench])
    expect(all.filter((x) => toolMatches(x, 'bo', names))).toEqual([jack, meter])
    expect(all.filter((x) => toolMatches(x, 'university', names))).toEqual([meter])
    expect(all.filter((x) => toolMatches(x, 'club tool', names))).toEqual([jack])
    expect(all.filter((x) => toolMatches(x, '   ', names))).toHaveLength(3)
  })
})
