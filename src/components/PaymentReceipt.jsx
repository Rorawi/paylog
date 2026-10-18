import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { repository } from '../data/repository.js';

export default function PaymentReceipt({ path }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [viewerUrl, setViewerUrl] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const attachmentRef = useRef(null);
  const buttonRef = useRef(null);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!path) return undefined;
    setPreviewUrl('');
    setError('');
    const loadPreview = () => repository.getPaymentReceiptUrl(path).then((url) => {
      if (active) setPreviewUrl(url);
    }).catch(() => {
      if (active) setError('Receipt image unavailable. Tap to retry.');
    });
    if (!window.IntersectionObserver) {
      loadPreview();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadPreview();
      }
    }, { rootMargin: '120px' });
    if (attachmentRef.current) observer.observe(attachmentRef.current);
    return () => { active = false; observer.disconnect(); };
  }, [path]);

  useEffect(() => {
    if (!viewerUrl) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setViewerUrl('');
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), a[href]')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [viewerUrl]);

  if (!path) return null;

  async function openReceipt() {
    returnFocusRef.current = buttonRef.current;
    setOpening(true);
    setError('');
    try {
      const url = await repository.getPaymentReceiptUrl(path);
      setPreviewUrl(url);
      setViewerUrl(url);
    } catch (caught) {
      setError(caught.message || 'Could not open receipt image. Tap to retry.');
    } finally {
      setOpening(false);
    }
  }

  return <>
    <div ref={attachmentRef} className="receipt-attachment">
      <button ref={buttonRef} className="receipt-thumb-button" type="button" onClick={openReceipt} disabled={opening} aria-label={opening ? 'Opening payment receipt' : 'View payment receipt'}>
        {previewUrl ? <img src={previewUrl} alt="" className="receipt-thumbnail"/> : <span className="receipt-thumbnail-placeholder"><Icon name="image" size={18}/></span>}
        <span>{opening ? 'Opening…' : 'View receipt'}</span>
      </button>
      {error && <span className="receipt-error" role="status">{error}</span>}
    </div>
    {viewerUrl && <div className="receipt-viewer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setViewerUrl(''); }}>
      <section ref={dialogRef} className="receipt-viewer" role="dialog" aria-modal="true" aria-labelledby="receipt-viewer-title">
        <header><h2 id="receipt-viewer-title">Payment receipt</h2><button ref={closeRef} className="icon-button" type="button" onClick={() => setViewerUrl('')} aria-label="Close receipt"><Icon name="close"/></button></header>
        <img src={viewerUrl} alt="Receipt or screenshot for this payment"/>
      </section>
    </div>}
  </>;
}
