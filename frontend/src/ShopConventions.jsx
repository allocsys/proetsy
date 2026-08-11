import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';
import { api } from '@/hooks/useApi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

function FieldRow({ children, className }) {
  return (
    <div className={`grid gap-3 sm:grid-cols-3 ${className || ''}`}>
      {children}
    </div>
  );
}

function Field({ label, id, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ShopConventions() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [titleSeparator, setTitleSeparator] = useState('|');
  const [maxTitleLength, setMaxTitleLength] = useState(140);
  const [tagsPerListing, setTagsPerListing] = useState(13);
  const [tagAlternates, setTagAlternates] = useState(5);
  const [maxTagLength, setMaxTagLength] = useState(20);
  const [forbiddenTitleWordsText, setForbiddenTitleWordsText] = useState('');
  const [aiDisclosurePhrasesText, setAiDisclosurePhrasesText] = useState('');
  const [deliveryDetailPhrasesText, setDeliveryDetailPhrasesText] = useState('');

  const [mjVersion, setMjVersion] = useState('--v 6.0');
  const [mjStyle, setMjStyle] = useState('--style raw');
  const [stylizeMin, setStylizeMin] = useState(0);
  const [stylizeMax, setStylizeMax] = useState(1000);
  const [defaultStylize, setDefaultStylize] = useState(250);
  const [aspectRatios, setAspectRatios] = useState([]);

  useEffect(() => {
    api.shopConventions
      .get()
      .then((cfg) => {
        setLoading(false);
        if (cfg.listing) {
          setTitleSeparator(cfg.listing.titleSeparator ?? '|');
          setMaxTitleLength(cfg.listing.maxTitleLength ?? 140);
          setTagsPerListing(cfg.listing.tagsPerListing ?? 13);
          setTagAlternates(cfg.listing.tagAlternates ?? 5);
          setMaxTagLength(cfg.listing.maxTagLength ?? 20);
          setForbiddenTitleWordsText((cfg.listing.forbiddenTitleWords || []).join('\n'));
          setAiDisclosurePhrasesText((cfg.listing.aiDisclosurePhrases || []).join('\n'));
          setDeliveryDetailPhrasesText((cfg.listing.deliveryDetailPhrases || []).join('\n'));
        }
        if (cfg.midjourney) {
          setMjVersion(cfg.midjourney.version ?? '--v 6.0');
          setMjStyle(cfg.midjourney.style ?? '--style raw');
          setStylizeMin(cfg.midjourney.stylizeMin ?? 0);
          setStylizeMax(cfg.midjourney.stylizeMax ?? 1000);
          setDefaultStylize(cfg.midjourney.defaultStylize ?? 250);
          const arObj = cfg.midjourney.aspectRatioByOrientation || {};
          setAspectRatios(
            Object.entries(arObj).map(([orientation, ratio]) => ({ orientation, ratio }))
          );
        }
      })
      .catch((err) => {
        setLoading(false);
        setErrorMessage(`Failed to load shop conventions: ${err.message}`);
      });
  }, []);

  function addAspectRatioRow() {
    setAspectRatios((prev) => [...prev, { orientation: '', ratio: '1:1' }]);
  }

  function updateAspectRatioRow(index, field, value) {
    setAspectRatios((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function removeAspectRatioRow(index) {
    setAspectRatios((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    const listingPayload = {
      titleSeparator,
      maxTitleLength: Number(maxTitleLength),
      tagsPerListing: Number(tagsPerListing),
      tagAlternates: Number(tagAlternates),
      maxTagLength: Number(maxTagLength),
      forbiddenTitleWords: forbiddenTitleWordsText.split('\n').map((s) => s.trim()).filter(Boolean),
      aiDisclosurePhrases: aiDisclosurePhrasesText.split('\n').map((s) => s.trim()).filter(Boolean),
      deliveryDetailPhrases: deliveryDetailPhrasesText.split('\n').map((s) => s.trim()).filter(Boolean),
    };

    const aspectRatioByOrientation = Object.fromEntries(
      aspectRatios.filter((r) => r.orientation.trim()).map((r) => [r.orientation.trim(), r.ratio.trim()])
    );

    const midjourneyPayload = {
      version: mjVersion,
      style: mjStyle,
      stylizeMin: Number(stylizeMin),
      stylizeMax: Number(stylizeMax),
      defaultStylize: Number(defaultStylize),
      aspectRatioByOrientation,
    };

    try {
      await api.shopConventions.patch({ listing: listingPayload, midjourney: midjourneyPayload });
      setSuccessMessage('Shop conventions saved successfully.');
      toast.success('Shop conventions saved');
    } catch (err) {
      setErrorMessage(err.message);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <FieldRow>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
        </FieldRow>
        <FieldRow>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
          <div className="space-y-1.5"><Skeleton className="h-8 w-full" /></div>
        </FieldRow>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Error / Success banners */}
      {errorMessage && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-2.5">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button variant="ghost" size="icon-xs" onClick={() => setErrorMessage('')} aria-label="Dismiss">
            <X className="size-3" />
          </Button>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/50 bg-emerald-500/5 px-4 py-2.5">
          <p className="text-sm text-emerald-400">{successMessage}</p>
          <Button variant="ghost" size="icon-xs" onClick={() => setSuccessMessage('')} aria-label="Dismiss">
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Listing Conventions */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground">Listing conventions</h4>
        <FieldRow>
          <Field label="Title separator" id="shop-conv-title-separator">
            <Input
              id="shop-conv-title-separator"
              value={titleSeparator}
              onChange={(e) => setTitleSeparator(e.target.value)}
            />
          </Field>
          <Field label="Max title length" id="shop-conv-max-title-length">
            <Input
              id="shop-conv-max-title-length"
              type="number"
              value={maxTitleLength}
              onChange={(e) => setMaxTitleLength(e.target.value)}
            />
          </Field>
          <Field label="Tags per listing" id="shop-conv-tags-per-listing">
            <Input
              id="shop-conv-tags-per-listing"
              type="number"
              value={tagsPerListing}
              onChange={(e) => setTagsPerListing(e.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow className="sm:grid-cols-2">
          <Field label="Tag alternates" id="shop-conv-tag-alternates">
            <Input
              id="shop-conv-tag-alternates"
              type="number"
              value={tagAlternates}
              onChange={(e) => setTagAlternates(e.target.value)}
            />
          </Field>
          <Field label="Max tag length" id="shop-conv-max-tag-length">
            <Input
              id="shop-conv-max-tag-length"
              type="number"
              value={maxTagLength}
              onChange={(e) => setMaxTagLength(e.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow className="sm:grid-cols-2">
          <Field label="Forbidden title words (one per line)" id="shop-conv-forbidden-words">
            <Textarea
              id="shop-conv-forbidden-words"
              rows={4}
              className="font-mono text-xs"
              value={forbiddenTitleWordsText}
              onChange={(e) => setForbiddenTitleWordsText(e.target.value)}
            />
          </Field>
          <Field label="AI disclosure phrases (one per line)" id="shop-conv-ai-disclosure">
            <Textarea
              id="shop-conv-ai-disclosure"
              rows={4}
              className="font-mono text-xs"
              value={aiDisclosurePhrasesText}
              onChange={(e) => setAiDisclosurePhrasesText(e.target.value)}
            />
          </Field>
        </FieldRow>

        <Field label="Delivery detail phrases (one per line)" id="shop-conv-delivery-phrases">
          <Textarea
            id="shop-conv-delivery-phrases"
            rows={3}
            className="font-mono text-xs"
            value={deliveryDetailPhrasesText}
            onChange={(e) => setDeliveryDetailPhrasesText(e.target.value)}
          />
        </Field>
      </div>

      <Separator />

      {/* Midjourney Conventions */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground">Midjourney conventions</h4>
        <FieldRow>
          <Field label="Version" id="shop-conv-mj-version">
            <Input
              id="shop-conv-mj-version"
              value={mjVersion}
              onChange={(e) => setMjVersion(e.target.value)}
            />
          </Field>
          <Field label="Style" id="shop-conv-mj-style">
            <Input
              id="shop-conv-mj-style"
              value={mjStyle}
              onChange={(e) => setMjStyle(e.target.value)}
            />
          </Field>
          <Field label="Default stylize" id="shop-conv-default-stylize">
            <Input
              id="shop-conv-default-stylize"
              type="number"
              value={defaultStylize}
              onChange={(e) => setDefaultStylize(e.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow className="sm:grid-cols-2">
          <Field label="Stylize min" id="shop-conv-stylize-min">
            <Input
              id="shop-conv-stylize-min"
              type="number"
              value={stylizeMin}
              onChange={(e) => setStylizeMin(e.target.value)}
            />
          </Field>
          <Field label="Stylize max" id="shop-conv-stylize-max">
            <Input
              id="shop-conv-stylize-max"
              type="number"
              value={stylizeMax}
              onChange={(e) => setStylizeMax(e.target.value)}
            />
          </Field>
        </FieldRow>

        {/* Aspect Ratios */}
        <div className="space-y-3">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aspect ratio by orientation</h5>
          <div className="space-y-2">
            {aspectRatios.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="Orientation (e.g. portrait)"
                  value={row.orientation}
                  onChange={(e) => updateAspectRatioRow(index, 'orientation', e.target.value)}
                  className="flex-1 h-8"
                />
                <Input
                  placeholder="Ratio (e.g. 3:4)"
                  value={row.ratio}
                  onChange={(e) => updateAspectRatioRow(index, 'ratio', e.target.value)}
                  className="w-28 h-8"
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeAspectRatioRow(index)}
                  aria-label="Remove orientation ratio"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="xs" onClick={addAspectRatioRow} className="gap-1">
            <Plus className="size-3" />
            Add orientation aspect ratio
          </Button>
        </div>
      </div>

      {/* Save button */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save shop conventions
        </Button>
      </div>
    </div>
  );
}

export default ShopConventions;
