"use client";
import { useRef, useState } from "react";
import { Button } from "./ui/primitives";
import { directError, directRequest } from "../lib/direct-client";
type Person = { id: string; username: string; displayName: string | null };
export function PeoplePicker({
  value,
  onChange,
  disabled = false,
  limit = 30,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const version = useRef(0);
  async function find() {
    const request = ++version.current;
    setPending(true);
    setError("");
    setPerson(null);
    try {
      const result = await directRequest<{ person: Person }>("people/find", {
        username: query.trim().toLowerCase(),
      });
      if (request === version.current) setPerson(result.person);
    } catch (error) {
      if (request === version.current) setError(directError(error));
    } finally {
      if (request === version.current) setPending(false);
    }
  }
  return (
    <fieldset className="people-picker" disabled={disabled}>
      <legend>Invite people (optional)</legend>
      <label>
        Search by username
        <input
          value={query}
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={30}
          onChange={(event) => {
            version.current++;
            setQuery(event.target.value);
            setPerson(null);
            setError("");
            setPending(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void find();
            }
          }}
        />
      </label>
      <Button
        type="button"
        loading={pending}
        disabled={!query.trim()}
        onClick={() => void find()}
      >
        Find person
      </Button>
      {person && (
        <div className="social-member-row">
          <span>
            {person.displayName ?? person.username} · @{person.username}
          </span>
          <Button
            type="button"
            disabled={value.includes(person.username) || value.length >= limit}
            onClick={() => {
              onChange([...value, person.username]);
              setPerson(null);
              setQuery("");
            }}
          >
            {value.includes(person.username) ? "Selected" : "Add person"}
          </Button>
        </div>
      )}
      {value.length > 0 && (
        <ul className="selected-people" aria-label="Selected people">
          {value.map((name) => (
            <li key={name}>
              <span>@{name}</span>
              <Button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(value.filter((item) => item !== name))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      <small>
        Search uses an exact username. Each person chooses whether to accept.
      </small>
    </fieldset>
  );
}
