# Voice Command Usage Examples

## Example 1: Basic Voice Navigation

```typescript
import VoiceNavigation from '../components/VoiceNavigation';

function App() {
  return (
    <div>
      <VoiceNavigation />
      {/* Your app content */}
    </div>
  );
}
```

## Example 2: Page-Specific Voice Commands

```typescript
import { useState } from 'react';
import VoiceCommands from '../components/VoiceCommands';

function ProposalsPage() {
  const [showModal, setShowModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);

  return (
    <div>
      {/* Your page content */}
      
      <VoiceCommands
        onCreateProposal={() => setShowModal(true)}
        onApprove={() => selectedProposal && handleApprove(selectedProposal)}
        onReject={() => selectedProposal && handleReject(selectedProposal)}
      />
    </div>
  );
}
```

## Example 3: Voice-to-Text Input

```typescript
import { useState } from 'react';
import VoiceToText from '../components/VoiceToText';

function MyForm() {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  return (
    <form>
      <VoiceToText
        value={recipient}
        onChange={setRecipient}
        placeholder="Recipient address"
        className="input-class"
      />
      
      <VoiceToText
        value={amount}
        onChange={setAmount}
        placeholder="Amount"
        className="input-class"
      />
      
      <VoiceToText
        value={memo}
        onChange={setMemo}
        placeholder="Memo"
        className="input-class"
      />
    </form>
  );
}
```

## Example 4: Custom Voice Commands

```typescript
import { useEffect } from 'react';
import { voiceService } from '../utils/voiceRecognition';

function CustomCommandsPage() {
  useEffect(() => {
    // Register custom commands
    voiceService.registerCommand('export data', {
      command: 'Exporting data',
      action: () => {
        exportData();
        voiceService.speak('Data exported successfully');
      },
      aliases: ['download data', 'save data']
    });

    voiceService.registerCommand('refresh', {
      command: 'Refreshing page',
      action: () => {
        window.location.reload();
      },
      aliases: ['reload', 'update']
    });

    // Cleanup
    return () => {
      voiceService.unregisterCommand('export data');
      voiceService.unregisterCommand('refresh');
    };
  }, []);

  return <div>{/* Your content */}</div>;
}
```

## Example 5: Wake Word Configuration

```typescript
import { useEffect, useState } from 'react';
import { voiceService } from '../utils/voiceRecognition';

function VoiceSettings() {
  const [wakeWord, setWakeWord] = useState('vault');

  useEffect(() => {
    voiceService.init({
      wakeWord,
      continuous: true,
      lang: 'en-US'
    });
  }, [wakeWord]);

  return (
    <div>
      <label>
        Wake Word:
        <input
          value={wakeWord}
          onChange={(e) => setWakeWord(e.target.value)}
        />
      </label>
    </div>
  );
}
```

## Example 6: Voice Feedback

```typescript
import { voiceService } from '../utils/voiceRecognition';

function handleAction() {
  try {
    // Perform action
    performAction();
    
    // Provide voice feedback
    voiceService.speak('Action completed successfully');
  } catch (error) {
    voiceService.speak('Action failed. Please try again');
  }
}
```

## Example 7: Conditional Voice Commands

```typescript
import { useEffect } from 'react';
import { voiceService } from '../utils/voiceRecognition';

function ConditionalCommands({ userRole }) {
  useEffect(() => {
    if (userRole === 'admin') {
      voiceService.registerCommand('delete all', {
        command: 'Deleting all items',
        action: () => deleteAll(),
        aliases: ['remove all', 'clear all']
      });
    }

    return () => {
      voiceService.unregisterCommand('delete all');
    };
  }, [userRole]);

  return <div>{/* Your content */}</div>;
}
```

## Example 8: Mobile-Optimized Voice Input

```typescript
import { useState } from 'react';
import VoiceToText from '../components/VoiceToText';

function MobileForm() {
  const [text, setText] = useState('');

  return (
    <div className="mobile-container">
      <VoiceToText
        value={text}
        onChange={setText}
        placeholder="Tap mic to speak"
        className="w-full px-4 py-3 text-lg rounded-lg border"
      />
      
      <p className="text-sm text-gray-500 mt-2">
        Voice input works on mobile devices with microphone access
      </p>
    </div>
  );
}
```

## Testing Voice Commands

```typescript
// In your test file
import { voiceService } from '../utils/voiceRecognition';

describe('Voice Commands', () => {
  it('should register and execute command', () => {
    const mockAction = jest.fn();
    
    voiceService.registerCommand('test', {
      command: 'Test command',
      action: mockAction
    });
    
    // Simulate voice input
    // (actual implementation depends on your testing setup)
  });
});
```

## Best Practices

1. **Always provide fallback UI**: Voice commands should complement, not replace, traditional UI
2. **Clear feedback**: Use `voiceService.speak()` to confirm actions
3. **Error handling**: Handle microphone permission denials gracefully
4. **Command cleanup**: Unregister commands in useEffect cleanup
5. **Mobile testing**: Test on actual mobile devices for best results
6. **Accessibility**: Ensure voice commands work alongside screen readers
7. **Privacy**: Inform users that voice processing is local
