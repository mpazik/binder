import { expect, test } from "bun:test";
import "./tests/binary-matchers.ts";
import {
  type Base64,
  base64ToBase64Uri,
  base64ToBinary,
  type Base64Uri,
  base64UriToBinary,
  binaryToBase64Uri,
  uriBase64ToBase64,
} from "./encoding.ts";

const base64 = "Z2u/epyvS3aX+dNUNdL/yg" as Base64;
const uriBase64 = "Z2u_epyvS3aX-dNUNdL_yg" as Base64Uri;
const binary = new Uint8Array(new ArrayBuffer(16));
binary.set([
  0x67, 0x6b, 0xbf, 0x7a, 0x9c, 0xaf, 0x4b, 0x76, 0x97, 0xf9, 0xd3, 0x54, 0x35,
  0xd2, 0xff, 0xca,
]);

test("base64ToBinary", () => {
  expect(base64ToBinary(base64)).toEqualBuffer(binary);
});

test("binaryToBase64", () => {
  expect(base64ToBinary(base64)).toEqualBuffer(binary);
});

test("base64ToWebBase64", () => {
  expect(base64ToBase64Uri(base64)).toEqual(uriBase64);
});

test("uriBase64ToBase64", () => {
  expect(uriBase64ToBase64(uriBase64)).toEqual(base64);
});

test("base64UriToBinary", () => {
  expect(base64UriToBinary(uriBase64)).toEqualBuffer(binary);
});

test("binaryToBase64Uri", () => {
  expect(binaryToBase64Uri(binary)).toEqual(uriBase64);
});
