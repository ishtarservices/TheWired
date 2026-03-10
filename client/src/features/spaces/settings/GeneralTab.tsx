import { useState, useEffect, useRef } from "react";
import { Button } from "../../../components/ui/Button";
import { ImageUpload } from "../../../components/ui/ImageUpload";
import { useAppSelector, useAppDispatch } from "../../../store/hooks";
import { updateSpace } from "../../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../../lib/db/spaceStore";
import { useAutoResize } from "../../../hooks/useAutoResize";

interface GeneralTabProps {
  spaceId: string;
}

export function GeneralTab({ spaceId }: GeneralTabProps) {
  const dispatch = useAppDispatch();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));

  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [saved, setSaved] = useState(false);
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(aboutRef, about, 200);

  useEffect(() => {
    if (!space) return;
    setName(space.name);
    setAbout(space.about ?? "");
    setPicture(space.picture ?? "");
  }, [space]);

  if (!space) return null;

  function handleSave() {
    const updated = {
      ...space!,
      name: name.trim() || space!.name,
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
    };
    dispatch(updateSpace(updated));
    updateSpaceInStore(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-heading">General Settings</h3>

      <div>
        <label className="mb-1 block text-xs font-medium text-soft">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl bg-field border border-edge px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-soft">Description</label>
        <textarea
          ref={aboutRef}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={2}
          className="w-full resize-none overflow-hidden rounded-xl bg-field border border-edge px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
        />
      </div>

      <ImageUpload
        value={picture}
        onChange={setPicture}
        label="Picture"
        placeholder="Drop space image or click to upload"
        shape="square"
      />

      <div className="flex items-center gap-3">
        <Button variant="primary" size="md" onClick={handleSave}>
          Save Changes
        </Button>
        {saved && <span className="text-xs text-green-400">Saved!</span>}
      </div>
    </div>
  );
}
