import React from 'react';
import {StyleSheet, View} from 'react-native';
import {WatchPartyScreen} from './screens/WatchPartyScreen';

export const App = () => {
  return (
    <View style={styles.root}>
      <WatchPartyScreen />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b0e14'},
});
