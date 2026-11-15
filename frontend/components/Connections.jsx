import {Check, Copy, ExternalLink, KeyRound, LogOut, MessageSquareText, Sparkles} from 'lucide-react';
import {useEffect, useState} from 'react';
import {api} from '../api.js';
import {chatgpt, toastError} from '../actions.js';
import {useStudio} from '../store.js';
import {Badge, Button, Callout, Field, Modal, Segmented, Spinner} from './ui.jsx';

function ChatGPTCard() {
  const chat = useStudio(s => s.data?.settings.chatgpt);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!chat) return null;
  const login = chat.login, pending = login.state === 'pending';
  const act = async (...args) => { setBusy(true); await chatgpt(...args); setBusy(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(login.code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} };

  return (
    <section className="conn-card">
      <header>
        <span className="conn-icon"><Sparkles size={16} /></span>
        <div><h3>ChatGPT account</h3><p>Creates the starting image from your saved model and the reference frame.</p></div>
        <Badge tone={chat.app_signed_in || chat.system_signed_in ? 'success' : 'neutral'} dot>{chat.app_signed_in ? 'Connected' : chat.system_signed_in ? 'Using Codex on this Mac' : 'Not connected'}</Badge>
      </header>

      {!chat.available && <Callout tone="warn" title="Codex tool not found">Automatic creation needs the Codex command-line tool on this Mac. You can still make images in the ChatGPT website — the Starting image step gives you a ready-made reference pack.</Callout>}

      {chat.available && !pending && !chat.app_signed_in && (
        <>
          <p className="conn-copy">Sign in with the ChatGPT account you want to use. You approve it on openai.com; Content Tool never sees your password.</p>
          <Button variant="primary" icon={MessageSquareText} loading={busy} onClick={() => act('connect')}>Connect ChatGPT account</Button>
          <p className="hint">Free and paid accounts can connect. Whether automatic image creation is included depends on your ChatGPT plan and limits. If it isn't, the Starting image step switches to a guided ChatGPT-website flow that works on free accounts.</p>
        </>
      )}

      {pending && (
        <div className="device">
          {!login.code ? <p className="conn-copy"><Spinner size={14} /> Requesting a sign-in code…</p> : (
            <>
              <ol>
                <li><span>Open the sign-in page</span><Button size="sm" icon={ExternalLink} onClick={() => window.open(login.url, '_blank', 'noopener')}>Open openai.com</Button></li>
                <li><span>Enter this one-time code</span>
                  <button type="button" className="code" onClick={copy} aria-label="Copy sign-in code"><b>{login.code}</b>{copied ? <Check size={14} /> : <Copy size={14} />}</button></li>
              </ol>
              <p className="hint"><Spinner size={12} /> Waiting for approval — this finishes automatically. Only continue if you started this sign-in. The code expires in 15 minutes.</p>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => act('cancel')}>Cancel</Button>
        </div>
      )}

      {login.state === 'error' && !pending && <Callout tone="error">{login.message}</Callout>}

      {chat.app_signed_in && (
        <div className="conn-actions">
          <Callout tone="success" icon={Check}>Connected. Image creation will use this account.</Callout>
          <Button size="sm" variant="ghost" icon={LogOut} loading={busy} onClick={() => act('disconnect')}>Disconnect</Button>
        </div>
      )}

      {chat.app_signed_in && chat.system_signed_in && (
        <Field label="Which sign-in should create images?">
          <Segmented value={chat.active || 'app'} onChange={v => act('use', {account: v})} options={[{value: 'app', label: 'This connection'}, {value: 'system', label: 'Codex on this Mac'}]} />
        </Field>
      )}
      {!chat.app_signed_in && chat.system_signed_in && !pending && <p className="hint">Codex is already signed in on this Mac, so automatic images work today. Connect an account here to use a different one.</p>}
    </section>
  );
}

function KeyForm({id, field, label, configured, placeholder, hint}) {
  const refresh = useStudio(s => s.refresh), toast = useStudio(s => s.toast);
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false);
  const save = async e => {
    e.preventDefault(); if (!key.trim()) return;
    setBusy(true);
    try { await api('/api/settings', {[field]: key.trim()}); setKey(''); await refresh(); toast(label + ' key saved on this Mac.', 'success'); } catch (error) { toastError(error); }
    setBusy(false);
  };
  return (
    <form onSubmit={save} className="conn-form">
      <Field label={configured ? 'Replace API key' : 'API key'} htmlFor={id} hint={hint}>
        <input id={id} type="password" autoComplete="off" spellCheck="false" placeholder={placeholder} value={key} onChange={e => setKey(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" disabled={!key.trim()} loading={busy}>Save key</Button>
    </form>
  );
}

function VideoCard() {
  const settings = useStudio(s => s.data?.settings), refresh = useStudio(s => s.refresh);
  if (!settings) return null;
  const provider = settings.video_provider || 'fal', aiml = provider === 'aimlapi';
  const configured = aiml ? settings.aimlapi_configured : settings.fal_configured;
  const choose = async v => { try { await api('/api/settings', {video_provider: v}); await refresh(); } catch (error) { toastError(error); } };
  return (
    <section className="conn-card">
      <header>
        <span className="conn-icon"><KeyRound size={16} /></span>
        <div><h3>Video generation</h3><p>Generates the motion with Kling 3.0. Each attempt is billed by the provider you pick.</p></div>
        <Badge tone={configured ? 'success' : 'warn'} dot>{configured ? 'Connected' : 'Key needed'}</Badge>
      </header>
      <Field label="Provider">
        <Segmented value={provider} onChange={choose} options={[{value: 'fal', label: 'fal.ai'}, {value: 'aimlapi', label: 'AIMLAPI'}]} />
      </Field>
      {aiml
        ? <KeyForm key="aiml" id="aiml-key" field="aimlapi_key" label="AIMLAPI" configured={configured} placeholder="Paste your AIMLAPI key" hint="Stored only on this Mac. An AIMLAPI_KEY in your .env file also works." />
        : <KeyForm key="fal" id="fal-key" field="fal_key" label="fal" configured={configured} placeholder="Paste your fal key" hint="Stored only on this Mac. A FAL_KEY in your .env file also works." />}
    </section>
  );
}

export function ConnectionsDialog() {
  const open = useStudio(s => s.dialog === 'connections'), close = useStudio(s => s.closeDialog);
  const pending = useStudio(s => s.data?.settings.chatgpt?.login.state === 'pending');
  useEffect(() => { if (open) api('/api/chatgpt', {action: 'check'}).then(() => useStudio.getState().refresh()).catch(() => {}); }, [open]);
  return (
    <Modal open={open} onOpenChange={o => !o && close()} title="Connections" description="Link the services Content Tool uses. Everything stays on this Mac." width={540}>
      <div className="conn-stack"><ChatGPTCard /><VideoCard /></div>
    </Modal>
  );
}
