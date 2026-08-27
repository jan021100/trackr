import test from 'node:test';
import assert from 'node:assert/strict';
import { sportsTypeSymbol } from '../src/lib/utils/sports.ts';

test('Intervals workout types receive recognizable symbols', () => {
  assert.equal(sportsTypeSymbol('WeightTraining'), '🏋️');
  assert.equal(sportsTypeSymbol('Run'), '🏃');
  assert.equal(sportsTypeSymbol('Ride'), '🚴');
  assert.equal(sportsTypeSymbol('GravelRide'), '🚵');
  assert.equal(sportsTypeSymbol('Golf'), '⛳');
  assert.equal(sportsTypeSymbol('Swim'), '🏊');
});

test('unknown and empty workout types use a neutral symbol instead of a letter', () => {
  assert.equal(sportsTypeSymbol('Other'), '●');
  assert.equal(sportsTypeSymbol(''), '●');
});
