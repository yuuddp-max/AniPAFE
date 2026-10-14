import assert from "node:assert/strict";
import test from "node:test";
import { googleAvatar } from "../src/lib/avatar";

test("Googleのプロフィール画像を取得し、画像なし・不正URLを除外する", () => {
  const image = "https://lh3.googleusercontent.com/test-photo=s96-c";
  assert.equal(googleAvatar({ user_metadata: { avatar_url: image } }), image);
  assert.equal(googleAvatar({ user_metadata: { picture: image } }), image);
  assert.equal(
    googleAvatar({
      identities: [{ provider: "google", identity_data: { picture: image } }],
      user_metadata: {
        avatar_url: "https://lh3.googleusercontent.com/old-photo",
      },
    }),
    image,
  );
  assert.equal(googleAvatar({ user_metadata: {} }), null);
  for (const avatar_url of [
    123,
    "",
    "javascript:alert(1)",
    "http://lh3.googleusercontent.com/photo",
    "https://googleusercontent.com.evil.test/photo",
    "https://evil.test/photo",
    "https://name:password@lh3.googleusercontent.com/photo",
  ])
    assert.equal(googleAvatar({ user_metadata: { avatar_url } }), null);
  assert.equal(
    googleAvatar({ user_metadata: { avatar_url: "invalid", picture: image } }),
    image,
  );
});
