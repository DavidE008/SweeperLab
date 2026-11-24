import { useState } from 'react';
import { Button, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

// Each five-cell strip has one mine. Only the numbered square is open.
const examples = [
  { clue: 0, mine: 1 },
  { clue: 4, mine: 3 },
];

export function DeductionLesson({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [solved, setSolved] = useState(false);
  const [feedback, setFeedback] = useState('');
  const { clue, mine } = examples[step];

  function choose(index: number) {
    if (index === mine) {
      setSolved(true);
      setFeedback('Exactly. The 1 touches only one covered square, so that square must contain the mine.');
    } else {
      setFeedback('Look at the squares that touch the 1. Which one could contain its mine?');
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.heading}>{step === 0 ? 'Find your first mine' : 'Try it from the other side'}</Text>
      <Text style={styles.copy}>{step === 0
        ? 'A 1 means exactly one touching square contains a mine. Tap the square you would flag.'
        : 'Where would you place a flag on this board?'}</Text>
      <View style={styles.row}>
        {Array.from({ length: 5 }, (_, index) => (
          <Pressable key={index} accessibilityRole="button"
            accessibilityLabel={`Square ${index + 1}, ${index === clue ? 'clue 1' : solved && index === mine ? 'flagged' : 'covered'}`}
            disabled={solved || index === clue} onPress={() => choose(index)}
            style={[styles.tile, index === clue && styles.open]}>
            <Text style={styles.value}>{index === clue ? '1' : solved && index === mine ? '⚑' : '□'}</Text>
          </Pressable>
        ))}
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.copy}>{feedback}</Text>
      {solved && step === 0 && <Button title="Try another board" onPress={() => {
        setStep(1); setSolved(false); setFeedback('');
      }} />}
      <Button title={solved && step === 1 ? 'Finish lesson' : 'Back to game'} onPress={onClose} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: '#E6F9FF', gap: 16 },
  heading: { fontSize: 26, fontWeight: '700', color: '#143552' },
  copy: { fontSize: 17, color: '#143552' },
  row: { flexDirection: 'row', gap: 4 },
  tile: { flex: 1, maxWidth: 60, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B9DCF8' },
  open: { backgroundColor: 'white' },
  value: { fontSize: 24, color: '#143552' },
});
