/** Welcome art belongs to the UI, never to the child's drawing or saved cover. */
export function StoryWelcome({ listening }: { listening: boolean }) {
  return (
    <div className="story-welcome" data-testid="story-welcome">
      <svg className="welcome-crayon" viewBox="0 0 420 230" fill="none" aria-hidden="true">
        <defs>
          <pattern id="wax-grain" width="7" height="9" patternUnits="userSpaceOnUse">
            <path d="m1 2 2 1m2 4 1 2" stroke="#fbf6ea" strokeWidth="1.4" opacity=".35" />
          </pattern>
        </defs>
        <g strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M80 194c27-38 66-30 89-8 22 20 44 28 71 12s55-17 95-7"
            stroke="#ddd1eb"
            strokeWidth="17"
          />
          <path
            d="M80 194c27-38 66-30 89-8 22 20 44 28 71 12s55-17 95-7"
            stroke="url(#wax-grain)"
            strokeWidth="18"
          />
          <path d="m80 194-12 8" stroke="#a28ab7" strokeWidth="5" />
          <g className="crayon-friend" transform="rotate(17 213 116)">
            <path
              d="m186 72 10-40q5-11 11 0l12 40"
              fill="#be9dda"
              stroke="#554366"
              strokeWidth="3.5"
            />
            <path d="m198 37 3-10 5 11" fill="#80609b" />
            <path
              d="M183 70q17-5 39 0l2 114q-18 9-40 0Z"
              fill="#bea0d5"
              stroke="#554366"
              strokeWidth="3.5"
            />
            <path d="m184 91 38-1 1 75-39 1Z" fill="#e5d5ef" stroke="#554366" strokeWidth="3" />
            <path d="m188 81 28-1m-26 95 27-1" stroke="#80609b" strokeWidth="3" />
            <path d="m189 75 1 102" stroke="#f7eafa" strokeWidth="3" opacity=".6" />
            <ellipse cx="195" cy="119" rx="2.8" ry="4" fill="#554366" />
            <ellipse cx="212" cy="119" rx="2.8" ry="4" fill="#554366" />
            <path d="M198 133q6 7 12-1" stroke="#554366" strokeWidth="2.8" />
            <path d="m188 130 5 1m21-1 5-1" stroke="#eab0b2" strokeWidth="4" />
            <path d="m183 142-13 6-5-9m58 2 12-12 6 2" stroke="#554366" strokeWidth="3" />
          </g>
          <path
            d="m119 65 5 13 14 1-11 9 3 14-12-7-12 7 3-14-10-9 14-1Z"
            fill="#f4d26d"
            stroke="#b3903e"
            strokeWidth="2.5"
          />
          <path
            d="m294 53 2 9 9 2-9 3-3 9-2-9-9-3 9-2Z"
            fill="#e9ada0"
            stroke="#bc7c6d"
            strokeWidth="2"
          />
          <path
            d="m296 132 6-8m6 19 10-2m-43-42 4-5M142 137l-7-5"
            stroke="#98b7a2"
            strokeWidth="3"
          />
          <path d="M328 96q19-5 14-19t-15 0 24 22" stroke="#96aebf" strokeWidth="2.5" />
          <circle cx="151" cy="43" r="3" fill="#b6c8ab" />
          <circle cx="270" cy="174" r="3" fill="#d8ac91" />
        </g>
      </svg>
      <h1>
        {listening ? (
          <>
            Your story starts
            <br />
            <span>with you.</span>
          </>
        ) : (
          <>
            Where will your
            <br />
            <span>imagination</span> take us?
          </>
        )}
      </h1>
      <p>
        {listening
          ? 'I’m listening. Tell me how your story begins…'
          : 'You tell the story. I’ll bring it to life.'}
      </p>
      {!listening && (
        <span className="welcome-whisper">A dragon? A moon picnic? Anything you dream up.</span>
      )}
    </div>
  )
}
