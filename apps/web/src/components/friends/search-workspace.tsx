"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, UserRound } from "lucide-react";
import { directRequest, directError } from "../../lib/direct-client";
import { Button, Avatar } from "../ui/primitives";
type Person = {
  id: string;
  username: string | null;
  displayName: string | null;
};
export function SearchWorkspace() {
  const [username, setUsername] = useState(""),
    [person, setPerson] = useState<Person | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [searched, setSearched] = useState(false);
  const router = useRouter();
  async function find(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setPerson(null);
    setMessage("");
    try {
      const r = await directRequest<{ person: Person | null }>("people/find", {
        username: username.trim().toLowerCase().replace(/^@/, ""),
      });
      setPerson(r.person);
      setSearched(true);
    } catch (error) {
      setMessage(directError(error));
    } finally {
      setPending(false);
    }
  }
  async function action(kind: "chat" | "friend") {
    if (!person || pending) return;
    setPending(true);
    try {
      if (kind === "chat") {
        const r = await directRequest<{ conversation: { id: string } }>(
          "direct/open",
          { username: person.username },
        );
        router.push(`/chats?conversation=${r.conversation.id}`);
      } else {
        await directRequest("friends/request", { username: person.username });
        setMessage("Friend request sent.");
      }
    } catch (error) {
      setMessage(directError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="search-workspace">
      <header className="feature-page-heading">
        <div>
          <p className="eyebrow">YOUR PEOPLE ARE A HELLO AWAY</p>
          <h1>Find someone</h1>
          <p className="supporting-copy">
            Search by their exact username. Private details stay private.
          </p>
        </div>
      </header>
      <form className="feature-actions" onSubmit={(e) => void find(e)}>
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Exact username"
            placeholder="@username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={31}
          />
        </label>
        <Button type="submit" variant="primary" loading={pending}>
          Find
        </Button>
      </form>
      {person && (
        <article className="people-result">
          <Avatar name={person.displayName ?? person.username ?? "Person"} />
          <div>
            <h2>{person.displayName}</h2>
            <p className="supporting-copy">@{person.username}</p>
          </div>
          <div className="feature-actions">
            <Button disabled={pending} onClick={() => void action("chat")}>
              Start a conversation
            </Button>
            <Button disabled={pending} onClick={() => void action("friend")}>
              Add friend
            </Button>
          </div>
        </article>
      )}
      {searched && !person && !pending && !message && (
        <div className="feature-empty">
          <UserRound size={28} />
          <h2>No match this time.</h2>
          <p>Check the exact username and try again.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
