import { CONVERSATION_PROFILES, MAX_MESSAGE } from "./conversation-contract";
import type {
  ConversationMessage,
  ConversationSession,
} from "./conversation-client";
import { CREW } from "./crew";

export type ConversationFactory = (
  npcId: number,
  changed: () => void,
) => ConversationSession;

/** All written dialogue is rendered as text, including service errors and greetings. */
export class ConversationPanel {
  private session?: ConversationSession;
  private transcript: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private status: HTMLSpanElement;
  private suggestions: HTMLDivElement;
  private disposed = false;
  private rendered: readonly ConversationMessage[] = [];
  private initialized = false;
  private showGreeting = true;
  private error = "";
  private scrollNext = false;
  private readonly profile;

  constructor(
    private host: HTMLElement,
    npcId: number,
    factory: ConversationFactory,
  ) {
    this.profile = CONVERSATION_PROFILES[npcId];
    this.host.classList.add("conversation-main");
    this.host.style.setProperty(
      "--crew-colour",
      CREW.find((crew) => crew.id === npcId)?.colour ?? "#c1d69a",
    );
    // This template contains only static markup. User and generated text never enters it.
    this.host.innerHTML = `<div class="chat-heading"><span class="chat-avatar" aria-hidden="true"></span><div class="chat-identity"><strong>Written conversation</strong><span></span></div><span class="chat-paused">Ⅱ WORLD PAUSED</span></div><div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><div class="chat-suggestions" aria-label="Conversation starters"></div><form class="chat-composer"><textarea rows="2" spellcheck="true"></textarea><button type="submit" class="chat-send">Send ↗</button></form><div class="chat-footer"><span class="chat-status" role="status" aria-live="polite"></span><span class="chat-shortcut">Enter to send · Shift + Enter for a new line</span></div>`;
    this.host.querySelector(".chat-avatar")!.textContent = this.profile.name[0];
    this.host.querySelector(".chat-identity span")!.textContent =
      `A moment with ${this.profile.name}`;
    this.transcript =
      this.host.querySelector<HTMLDivElement>(".chat-transcript")!;
    this.transcript.setAttribute(
      "aria-label",
      `Conversation with ${this.profile.name}`,
    );
    this.input = this.host.querySelector<HTMLTextAreaElement>("textarea")!;
    this.input.maxLength = MAX_MESSAGE;
    this.input.placeholder = `Ask ${this.profile.name} about life in the clearing…`;
    this.input.setAttribute("aria-label", `Message ${this.profile.name}`);
    this.input.setAttribute("aria-describedby", "conversation-status");
    this.sendButton = this.host.querySelector<HTMLButtonElement>(".chat-send")!;
    this.sendButton.setAttribute(
      "aria-label",
      `Send message to ${this.profile.name}`,
    );
    this.status = this.host.querySelector<HTMLSpanElement>(".chat-status")!;
    this.status.id = "conversation-status";
    this.suggestions =
      this.host.querySelector<HTMLDivElement>(".chat-suggestions")!;
    for (const topic of this.profile.topics) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = topic;
      button.onclick = () => {
        this.input.value = topic;
        this.updateComposer();
        this.input.focus();
      };
      this.suggestions.append(button);
    }
    this.input.addEventListener("input", () => this.updateComposer());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    this.host.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.session = factory(npcId, () => this.render());
    this.showGreeting = this.session.messages.length === 0;
    this.render();
    this.input.focus();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.session?.dispose();
  }

  private updateComposer() {
    const disabled = this.session?.disabled ?? true;
    this.input.disabled = disabled;
    this.sendButton.disabled =
      disabled || !!this.session?.pending || !this.input.value.trim();
    this.sendButton.textContent = this.session?.pending
      ? "Thinking…"
      : "Send ↗";
    for (const button of this.suggestions.querySelectorAll("button"))
      button.disabled = disabled;
  }

  private async send() {
    const session = this.session;
    const text = this.input.value.trim();
    if (
      this.disposed ||
      !session ||
      session.pending ||
      session.disabled ||
      !text
    )
      return;
    this.input.value = "";
    this.error = "";
    this.scrollNext = true;
    this.input.focus();
    try {
      await session.send(text);
    } catch {
      if (this.disposed) return;
      this.error = "That message could not be sent. Please try again.";
      if (!this.input.value) this.input.value = text;
    }
    this.render();
  }

  private message(
    role: "player" | "npc",
    text: string,
    source?: "openai" | "local",
    historical = false,
  ) {
    const article = document.createElement("article");
    article.className = `chat-message chat-message-${role}`;
    const speaker = document.createElement("div");
    speaker.className = "chat-speaker";
    const name = document.createElement("span");
    name.textContent = role === "player" ? "You" : this.profile.name;
    speaker.append(name);
    if (role === "npc") {
      const origin = document.createElement("span");
      origin.className = "chat-source";
      origin.textContent =
        (source === "openai"
          ? "AI reply"
          : source === "local"
            ? "Local reply"
            : "Greeting") + (historical ? " · earlier in this timeline" : "");
      speaker.append(origin);
    }
    const bubble = document.createElement("p");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    article.append(speaker, bubble);
    return article;
  }

  private render() {
    const session = this.session;
    if (this.disposed || !session) return;
    const messages = session.messages;
    const changed =
      !this.initialized ||
      messages.length !== this.rendered.length ||
      messages.some((message, i) => message !== this.rendered[i]);
    if (changed) {
      const nearBottom =
        this.transcript.scrollHeight -
          this.transcript.clientHeight -
          this.transcript.scrollTop <
        60;
      const appendOnly =
        this.initialized &&
        this.rendered.every((message, i) => message === messages[i]);
      const fragment = document.createDocumentFragment();
      if (!appendOnly) {
        this.transcript.replaceChildren();
        if (this.showGreeting)
          fragment.append(this.message("npc", this.profile.greeting));
      }
      for (const message of messages.slice(
        appendOnly ? this.rendered.length : 0,
      ))
        fragment.append(
          this.message(
            message.role,
            message.text,
            message.source,
            message.historical,
          ),
        );
      this.transcript.append(fragment);
      this.rendered = messages.slice();
      this.initialized = true;
      if (nearBottom || this.scrollNext)
        this.transcript.scrollTop = this.transcript.scrollHeight;
      this.scrollNext = false;
    }
    this.status.textContent = session.pending
      ? `${this.profile.name} is thinking…`
      : this.error || session.notice;
    this.status.dataset.pending = String(session.pending);
    this.transcript.setAttribute("aria-busy", String(session.pending));
    this.updateComposer();
  }
}
