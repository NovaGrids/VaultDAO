# Voice Command Support

VaultDAO includes comprehensive voice command support for accessibility and hands-free operation.

## Features

### 1. Voice Commands
- **Navigation**: Voice-controlled page navigation
- **Actions**: Create proposals, approve, reject via voice
- **Wake Word**: Optional wake word activation ("vault" by default)
- **Custom Commands**: Extensible command registry

### 2. Voice Navigation
- Navigate between pages: "dashboard", "proposals", "activity", "analytics", "settings"
- Back/forward navigation: "go back", "go forward"
- Current location: "where am i"

### 3. Voice-to-Text
- Form input support with microphone button
- Real-time speech-to-text conversion
- Works on all text inputs in proposal forms

### 4. Voice Feedback
- Audio confirmation of actions
- Status announcements
- Error notifications

## Usage

### Basic Setup

Voice support is automatically enabled in the DashboardLayout. The floating microphone button appears in the bottom-right corner.

### Voice Commands

Click the microphone button to start listening. Available commands:

**Navigation:**
- "dashboard" or "home" - Go to dashboard
- "proposals" - View proposals
- "activity" - View activity
- "analytics" - View analytics
- "settings" - Open settings
- "templates" - View templates
- "recurring payments" - View recurring payments

**Actions (on Proposals page):**
- "create proposal" or "new proposal" - Open new proposal form
- "approve" - Approve selected proposal
- "reject" - Reject selected proposal

**Navigation Controls:**
- "go back" or "back" - Navigate back
- "go forward" or "forward" - Navigate forward
- "where am i" - Announce current page

### Voice-to-Text in Forms

Text inputs with voice support show a microphone icon. Click to start recording, speak your input, and click again to stop.

### Customization

Click the settings icon next to the microphone button to:
- Change wake word
- View available commands
- Customize voice settings

## Browser Support

Voice features use the Web Speech API and require:
- Chrome/Edge 25+
- Safari 14.1+
- Firefox (limited support)

Mobile browsers require microphone permissions.

## Mobile Responsive

- Touch-optimized microphone button
- Automatic permission requests
- Optimized for mobile screen sizes
- Works with device microphone

## Implementation

### Adding Voice Commands

```typescript
import { voiceService } from '../utils/voiceRecognition';

voiceService.registerCommand('my command', {
  command: 'Executing my command',
  action: () => {
    // Your action here
  },
  aliases: ['alternative phrase', 'another way']
});
```

### Using VoiceToText Component

```typescript
import VoiceToText from '../components/VoiceToText';

<VoiceToText
  value={inputValue}
  onChange={setInputValue}
  placeholder="Enter text or use voice"
  className="your-classes"
/>
```

### Adding Page-Specific Commands

```typescript
import VoiceCommands from '../components/VoiceCommands';

<VoiceCommands
  onCreateProposal={() => handleCreate()}
  onApprove={() => handleApprove()}
  onReject={() => handleReject()}
/>
```

## Accessibility

Voice commands improve accessibility for:
- Users with mobility impairments
- Hands-free operation scenarios
- Multitasking workflows
- Screen reader users (complementary)

## Privacy

- Voice processing happens locally in the browser
- No audio data is sent to external servers
- Microphone access requires explicit user permission
- Audio streams are immediately closed after use

## Troubleshooting

**Microphone not working:**
- Check browser permissions
- Ensure HTTPS connection (required for microphone access)
- Try a different browser

**Commands not recognized:**
- Speak clearly and at normal pace
- Check wake word is correctly configured
- Ensure microphone is not muted
- Review available commands in settings

**Mobile issues:**
- Grant microphone permission when prompted
- Check device microphone is working
- Ensure browser supports Web Speech API
