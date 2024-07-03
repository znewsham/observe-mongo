// import { describe, it, mock } from "node:test";
// import assert from "node:assert";
// import { compileMongoQuery } from "mongo-query-compiler";
// import { FakeCollection } from "../../mongo-collection-hooks/test/collection/fakeCollection.js";
// import { ObjectId } from "bson";

// function safeMongoQuery(selector) {
//   if (typeof selector !== "object") {
//     return safeMongoQuery({ _id: selector });
//   }
//   if (!selector) {
//     return () => false;
//   }
//   if (Object.keys(selector).length === 0) {
//     return () => true;
//   }
//   return compileMongoQuery(selector);
// }

// describe("matcher", () => {
//   let shouldThrow = false;
//   const big = { a: [{ b: 1 }, 2, {}, { b: [3, 4] }] };
//   const matches = (shouldMatch, selector, doc, debug) => {
//     const outerError = new Error();
//     const stack = outerError.stack;
//     const expectThrow = shouldThrow;
//     it(`should work for selector: ${JSON.stringify(selector)}, document: ${JSON.stringify(doc)}`, () => {
//       let doesMatch;
//       if (expectThrow) {
//         const error = new Error("Expected to throw but didnt");
//         error.cause = outerError;
//         try {
//           doesMatch = [doc].filter(safeMongoQuery(selector)).length === 1;
//           assert.fail(error);
//         }
//         catch (e) {

//         }
//         return;
//       }
//       try {
//         if (debug ){
//           debugger;
//         }
//         doesMatch = [doc].filter(safeMongoQuery(selector)).length === 1;
//       }
//       catch (error) {
//         error.cause = outerError;
//         throw error;
//       }
//       const error = new Error(`minimongo match failure: document ${shouldMatch ? "should match, but doesn't" : "shouldn't match, but does"}`);
//       error.cause = outerError;
//       assert.strictEqual(
//         doesMatch,
//         shouldMatch,
//         error
//       );
//     });
//   };

//   const throws = (fn) => {
//     shouldThrow = true;
//     fn();
//     shouldThrow = false;
//   };

//   const match = matches.bind(null, true);
//   const nomatch = matches.bind(null, false);
//   const date1 = new Date();
//   const date2 = new Date(date1.getTime() + 1000);
//   const date3 = new Date("");
//   const reusedRegexp = /sh/ig;


//   // Tests with array of bit positions.
//   const allPositions = [];
//   for (let i = 0; i < 64; i++) {
//     allPositions.push(i);
//   }
//   const c = new FakeCollection([]);
//   function matchCount(query, count) {
//     const outerError = new Error();
//     it(`Should match the count ${query} ${count}`, async () => {
//       const matches = await c.find(query).count();
//       const error = new Error(`minimongo match count failure: matched ${matches} times, but should match ${count} times`);
//       error.cause = outerError;
//     if (matches !== count) {
//         assert.strictEqual(
//           matches,
//           count,
//           error
//         );
//       }
//     });
//   }


//   describe("These are the cases that are different between minimongo and mongo-query-compiler and minimongo is wrong", () => {
//     match({ _id: "" }, { _id: "" });
//     match({ _id: 0 }, { _id: 0 });

//     // c.insertOne({ a: EJSON.parse("{\"$binary\": \"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}") });
//     // c.insertOne({ a: EJSON.parse("{\"$binary\": \"AANgAAAAAAAAAAAAAAAAAAAAAAAA\"}") });
//     // c.insertOne({ a: EJSON.parse("{\"$binary\": \"JANgqwetkqwklEWRbWERKKJREtbq\"}") });
//     // c.insertOne({ a: EJSON.parse("{\"$binary\": \"////////////////////////////\"}") });

//     // // Tests with binary string bitmask.
//     // matchCount({ a: { $bitsAllSet: EJSON.parse("{\"$binary\": \"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 4);
//     // matchCount({ a: { $bitsAllSet: EJSON.parse("{\"$binary\": \"AANgAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 3);
//     // matchCount({ a: { $bitsAllSet: EJSON.parse("{\"$binary\": \"JANgqwetkqwklEWRbWERKKJREtbq\"}") } }, 2);
//     // matchCount({ a: { $bitsAllSet: EJSON.parse("{\"$binary\": \"////////////////////////////\"}") } }, 1);
//     // matchCount({ a: { $bitsAllClear: EJSON.parse("{\"$binary\": \"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 4);
//     // matchCount({ a: { $bitsAllClear: EJSON.parse("{\"$binary\": \"AAyfAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 3);
//     // matchCount({ a: { $bitsAllClear: EJSON.parse("{\"$binary\": \"JAyfqwetkqwklEWRbWERKKJREtbq\"}") } }, 2);
//     // matchCount({ a: { $bitsAllClear: EJSON.parse("{\"$binary\": \"////////////////////////////\"}") } }, 1);
//     // matchCount({ a: { $bitsAnySet: EJSON.parse("{\"$binary\": \"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 0);
//     // matchCount({ a: { $bitsAnySet: EJSON.parse("{\"$binary\": \"AAyfAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 1);
//     // matchCount({ a: { $bitsAnySet: EJSON.parse("{\"$binary\": \"JAyfqwetkqwklEWRbWERKKJREtbq\"}") } }, 2);
//     // matchCount({ a: { $bitsAnySet: EJSON.parse("{\"$binary\": \"////////////////////////////\"}") } }, 3);
//     // matchCount({ a: { $bitsAnyClear: EJSON.parse("{\"$binary\": \"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 0);
//     // matchCount({ a: { $bitsAnyClear: EJSON.parse("{\"$binary\": \"AANgAAAAAAAAAAAAAAAAAAAAAAAA\"}") } }, 1);
//     // matchCount({ a: { $bitsAnyClear: EJSON.parse("{\"$binary\": \"JANgqwetkqwklEWRbWERKKJREtbq\"}") } }, 2);
//     // matchCount({ a: { $bitsAnyClear: EJSON.parse("{\"$binary\": \"////////////////////////////\"}") } }, 3);

//     // match({ a: { $type: 5 } }, { a: EJSON.newBinary(0) });
//     // match({ a: { $type: "binData" } }, { a: EJSON.newBinary(0) });
//     // match({ a: { $type: 5 } }, { a: EJSON.newBinary(4) });

//     // // Tests with multiple predicates.
//     // matchCount({
//     //   a: {
//     //     $bitsAllSet: EJSON.parse("{\"$binary\": \"AANgAAAAAAAAAAAAAAAAAAAAAAAA\"}"),
//     //     $bitsAllClear: EJSON.parse("{\"$binary\": \"//yf////////////////////////\"}")
//     //   }
//     // }, 1);
//   });


//   describe("These are the cases that are different between minimongo and mongo-query-compiler and mongo-query-compiler is wrong", () => {
//     // // THESE NEED TO BE FIXED
//     // match({ a: { $gt: date3 } }, { a: date1 });
//     // match({ a: { $gte: date3 } }, { a: date1 });

//     // throws(() => {
//     //   match(
//     //     { a: { $elemMatch: { $gte: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//     //     { a: [{ x: 1, b: 1 }] }
//     //   );
//     // });
//     // nomatch({ a: { $elemMatch: { x: 5 } } }, { a: { x: 5 } });
//     // nomatch({ x: { $elemMatch: { $gt: 5, $lt: 9 } } }, { x: [[8]] });
//     // nomatch({ x: { $elemMatch: { y: 9 } } }, { x: [[{ y: 9 }]] });
//     // match(
//     //   { "animals.dogs.name": "Fido" },
//     //   {
//     //     animals: [
//     //       { dogs: [{ name: "Rover" }] },
//     //       {},
//     //       { dogs: [{ name: ["Fido"] }, { name: "Rex" }] }
//     //     ]
//     //   }
//     // );
//     // match(
//     //   { "animals.dogs.name": "Fido" },
//     //   {
//     //     animals: [{ dogs: [{ name: "Rover" }] },
//     //       {},
//     //       { dogs: [{ name: "Fido" }, { name: "Rex" }] }]
//     //   }
//     // );
//     // match({ "dogs.name": "Rex" }, { dogs: [{ name: "Fido" }, { name: "Rex" }] });
//     // match({ $where: "obj.a === 1" }, { a: 1 });
//     // nomatch({ $where: "obj.a !== 1" }, { a: 1 });
//     // match({ $and: [{ a: { $ne: 1 } }] }, {});
//     // match({ $and: [{ a: { $nin: [] } }] }, {});
//     // nomatch({ $nor: [{ a: { $ne: 1 } }] }, { b: 1 });
//     // nomatch({ $nor: [{ a: { $ne: 1 } }, { b: { $ne: 1 } }] }, { a: 1 });
//     // nomatch({ $nor: [{ a: { $ne: 1 } }] }, {});
//     // match({ $or: [{ a: { $ne: 1 } }] }, {});
//     // match({ $or: [{ a: { $ne: 1 } }] }, { b: 1 });
//     // match({ $or: [{ a: { $ne: 1 } }, { b: { $ne: 1 } }] }, { a: 1 });
//     // nomatch({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { c: 3 });
//     // nomatch({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [1, 2, 3] } }] }, { b: 2 });
//     // match({ $nor: [{ a: { b: 1, c: 3 } }, { a: { b: 2, c: 1 } }] }, { a: { b: 1, c: 2 } });
//     // match({ "a.1.foo": null }, { a: [{ 1: { foo: 4 } }, { foo: 5 }] });
//     // match({ "a.b": { $in: [{ x: 1 }, { x: 2 }, { x: 3 }] } }, { a: { b: [{ x: 2 }] } });
//     // match({ "a.b": { $in: [1, 2, 3] } }, { a: { b: [4, 2] } });
//     // match({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { c: 3 });
//     // match({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [1, 2, 3] } }] }, { b: 2 });
//     // nomatch({ $or: [{ a: { b: 1, c: 3 } }, { a: { b: 2, c: 1 } }] }, { a: { b: 1, c: 2 } });
//     // nomatch({ "a.1": 8 }, { a: [[6, 7], [8, 9]] });
//     // nomatch({ "a.1": 9 }, { a: [[6, 7], [8, 9]] });
//     // match({ "a.1": 2 }, { a: [0, { 1: 2 }, 3] });
//     // match({ "x.1.y": null }, { x: [7, { y: 8 }, 9] });
//     // match({ "a.1.b": "foo" }, { a: [7, { b: 9 }, { 1: { b: "foo" } }] });
//     // match({ "a.1.b": null }, { a: [7, { b: 9 }, { 1: { b: "foo" } }] });
//     // match({ "a.1": 4 }, { a: [{ 1: 4 }, 5] });
//     // match({ "a.1.foo": 4 }, { a: [{ 1: { foo: 4 } }, { foo: 5 }] });
//     // match({ "a.b": [3, 4] }, big);
//     // match({ "a.b": 3 }, big);
//     // match({ "a.b": 4 }, big);
//     // match({ "a.b": null }, big); // matches on slot 2
//     // match({ "a.b.c": null }, {});
//     // match({ "a.b.c": null }, { a: 1 });
//     // match({ "a.b": null }, { a: 1 });
//     // match({ "a.b.c": null }, { a: { b: 4 } });
//     // nomatch({ a: /a/ }, { a: /a/i });
//     // nomatch({ a: /a/m }, { a: /a/ });
//     // nomatch({ a: /5/ }, { a: 5 });
//     // nomatch({ a: /t/ }, { a: true });
//     // match({ x: { $not: { $lt: 10, $gt: 7 } } }, { x: 11 });
//     // match({ x: { $not: { $lt: 10, $gt: 7 } } }, { x: 6 });

//     // // GitHub issue #2817:
//     // // Regexps with a global flag ('g') keep a state when tested against the same
//     // // string. Selector shouldn't return different result for similar documents
//     // // because of this state.
//     // match({ a: reusedRegexp }, { a: "Shorts" });
//     // match({ a: reusedRegexp }, { a: "Shorts" });
//     // match({ a: reusedRegexp }, { a: "Shorts" });
//     // match({ a: { $regex: reusedRegexp } }, { a: "Shorts" });
//     // match({ a: reusedRegexp }, { a: "Shorts" });
//     // match({ a: { $regex: "a" } }, { a: "cat" });
//     // nomatch({ a: { $regex: "a" } }, { a: "cut" });
//     // nomatch({ a: { $regex: "a" } }, { a: "CAT" });
//     // match({ a: { $regex: "a", $options: "i" } }, { a: "CAT" });
//     // match({ a: { $regex: "", $options: "i" } }, { a: "foo" });
//     // nomatch({ a: { $regex: "", $options: "i" } }, { a: 5 });
//     // match({ a: { $regex: /a/, $options: "i" } }, { a: "CAT" }); // tested
//     // match({ a: { $regex: /a/i, $options: "i" } }, { a: "CAT" }); // tested
//     // nomatch({ a: /,/ }, { a: ["foo", "bar"] }); // but not by stringifying
//     // match({ a: { $regex: "a" } }, { a: ["foo", "bar"] });
//     // nomatch({ a: { $regex: "," } }, { a: ["foo", "bar"] });
//     // nomatch({ a: { $type: 4 } }, { a: [] });
//     // nomatch({ a: { $type: 4 } }, { a: [1] }); // tested against mongodb
//     // match({ a: { $type: 1 } }, { a: [1] });
//     // nomatch({ a: { $type: 2 } }, { a: [1] });
//     // match({ a: { $type: 1 } }, { a: ["1", 1] });
//     // match({ a: { $type: 2 } }, { a: ["1", 1] });
//     // nomatch({ a: { $type: 3 } }, { a: ["1", 1] });
//     // nomatch({ a: { $type: 4 } }, { a: ["1", 1] });
//     // nomatch({ a: { $type: 1 } }, { a: ["1", []] });
//     // match({ a: { $type: 2 } }, { a: ["1", []] });
//     // match({ a: { $type: 4 } }, { a: ["1", []] }); // tested against mongodb
//     // // An exception to the normal rule is that an array found via numeric index is
//     // // examined itself, and its elements are not.
//     // match({ "a.0": { $type: 4 } }, { a: [[0]] });
//     // nomatch({ "a.0": { $type: 1 } }, { a: [[0]] });
//     // nomatch({ a: { $type: 3 } }, { a: [] });
//     // nomatch({ a: { $type: 3 } }, { a: [1] });
//     // nomatch({ a: { $type: 3 } }, { a: null });
//     // nomatch({ a: { $type: 5 } }, { a: [] });
//     // nomatch({ a: { $type: 5 } }, { a: [42] });
//     // match({ a: { $type: 7 } }, { a: new ObjectId() });
//     // match({ a: { $type: "objectId" } }, { a: new ObjectId() });
//     // nomatch({ a: { $type: 7 } }, { a: "1234567890abcd1234567890" });
//     // match({ a: { $type: 8 } }, { a: true });
//     // match({ a: { $type: "bool" } }, { a: true });
//     // match({ a: { $type: 8 } }, { a: false });
//     // nomatch({ a: { $type: 8 } }, { a: "true" });
//     // nomatch({ a: { $type: 8 } }, { a: 0 });
//     // nomatch({ a: { $type: 8 } }, { a: null });
//     // nomatch({ a: { $type: 8 } }, { a: "" });
//     // match({ a: { $type: 9 } }, { a: new Date() });
//     // nomatch({ a: { $type: 9 } }, { a: +new Date() });
//     // match({ a: { $type: 10 } }, { a: null });
//     // nomatch({ a: { $type: 10 } }, { a: false });
//     // nomatch({ a: { $type: 10 } }, { a: "" });
//     // nomatch({ a: { $type: 10 } }, { a: 0 });
//     // match({ a: { $type: 11 } }, { a: /x/ });
//     // match({ a: { $type: "regex" } }, { a: /x/ });
//     // nomatch({ a: { $type: 11 } }, { a: "x" });
//     // match({ a: { $type: 1 } }, { a: 1.1 });
//     // match({ a: { $type: 1 } }, { a: 1 });
//     // nomatch({ a: { $type: 1 } }, { a: "1" });
//     // match({ a: { $type: 2 } }, { a: "1" });
//     // nomatch({ a: { $type: 2 } }, { a: 1 });
//     // match({ a: { $type: 3 } }, { a: {} });
//     // match({ a: { $type: 3 } }, { a: { b: 2 } });
//     // match({ a: { $type: "double" } }, { a: 1.1 });



//     // matchCount({ a: { $bitsAllSet: [] } }, 3);
//     // matchCount({ a: { $bitsAllSet: [1] } }, 2);
//     // matchCount({ a: { $bitsAllSet: allPositions } }, 1);
//     // matchCount({ a: { $bitsAllSet: [1, 7, 6, 3, 100] } }, 2);
//     // matchCount({ a: { $bitsAllClear: [] } }, 3);
//     // matchCount({ a: { $bitsAllClear: [5, 4, 2, 0] } }, 2);
//     // matchCount({ a: { $bitsAllClear: allPositions } }, 1);
//     // matchCount({ a: { $bitsAnySet: [1] } }, 2);
//     // matchCount({ a: { $bitsAnySet: allPositions } }, 2);
//     // matchCount({ a: { $bitsAnyClear: [0, 2, 4, 5, 100] } }, 2);
//     // matchCount({ a: { $bitsAnyClear: allPositions } }, 2);
//     // matchCount({ a: { $bitsAllSet: 74, $bitsAllClear: 53 } }, 1);
//     // matchCount({ a: { $bitsAnyClear: [1, 4] } }, 3);
//     // matchCount({ a: { $bitsAnyClear: [3, 4] } }, 3);
//     // matchCount({ a: { $bitsAnyClear: [0, 1, 2, 3, 4, 5, 6, 7] } }, 4);

//     // // Tests with multiple predicates.
//     // matchCount({ a: { $bitsAllSet: 54, $bitsAllClear: 201 } }, 1);

//     // // Tests on negative numbers

//     // c.deleteMany({});
//     // c.insertOne({ a: -0 });
//     // c.insertOne({ a: -1 });

//     // // Tests with bitmask.
//     // matchCount({ a: { $bitsAllSet: 0 } }, 3);
//     // matchCount({ a: { $bitsAllSet: 2 } }, 2);
//     // matchCount({ a: { $bitsAllSet: 127 } }, 1);
//     // matchCount({ a: { $bitsAllSet: 74 } }, 2);
//     // matchCount({ a: { $bitsAllClear: 0 } }, 3);
//     // matchCount({ a: { $bitsAllClear: 53 } }, 2);
//     // matchCount({ a: { $bitsAllClear: 127 } }, 1);
//     // matchCount({ a: { $bitsAnySet: 2 } }, 2);
//     // matchCount({ a: { $bitsAnySet: 127 } }, 2);
//     // matchCount({ a: { $bitsAnyClear: 53 } }, 2);
//     // matchCount({ a: { $bitsAnyClear: 127 } }, 2);
//     // matchCount({ a: { $bitsAllSet: 0 } }, 5);
//     // matchCount({ a: { $bitsAllSet: 1 } }, 2);
//     // matchCount({ a: { $bitsAllSet: 16 } }, 3);
//     // matchCount({ a: { $bitsAllSet: 54 } }, 2);
//     // matchCount({ a: { $bitsAllSet: 55 } }, 1);
//     // matchCount({ a: { $bitsAllSet: 88 } }, 2);
//     // matchCount({ a: { $bitsAllSet: 255 } }, 1);
//     // matchCount({ a: { $bitsAllClear: 0 } }, 5);
//     // matchCount({ a: { $bitsAllClear: 1 } }, 3);
//     // matchCount({ a: { $bitsAllClear: 16 } }, 2);
//     // matchCount({ a: { $bitsAllClear: 129 } }, 3);
//     // matchCount({ a: { $bitsAllClear: 255 } }, 1);
//     // matchCount({ a: { $bitsAnySet: 9 } }, 3);
//     // matchCount({ a: { $bitsAnySet: 255 } }, 4);
//     // matchCount({ a: { $bitsAnyClear: 18 } }, 3);
//     // matchCount({ a: { $bitsAnyClear: 24 } }, 3);
//     // matchCount({ a: { $bitsAnyClear: 255 } }, 4);

//     // // Tests with array of bit positions.
//     // matchCount({ a: { $bitsAllSet: [] } }, 5);
//     // matchCount({ a: { $bitsAllSet: [0] } }, 2);
//     // matchCount({ a: { $bitsAllSet: [4] } }, 3);
//     // matchCount({ a: { $bitsAllSet: [1, 2, 4, 5] } }, 2);
//     // matchCount({ a: { $bitsAllSet: [0, 1, 2, 4, 5] } }, 1);
//     // matchCount({ a: { $bitsAllSet: [3, 4, 6] } }, 2);
//     // matchCount({ a: { $bitsAllSet: [0, 1, 2, 3, 4, 5, 6, 7] } }, 1);
//     // matchCount({ a: { $bitsAllClear: [] } }, 5);
//     // matchCount({ a: { $bitsAllClear: [0] } }, 3);
//     // matchCount({ a: { $bitsAllClear: [4] } }, 2);
//     // matchCount({ a: { $bitsAllClear: [1, 7] } }, 3);
//     // matchCount({ a: { $bitsAllClear: [0, 1, 2, 3, 4, 5, 6, 7] } }, 1);
//     // matchCount({ a: { $bitsAnySet: [1, 3] } }, 3);
//     // matchCount({ a: { $bitsAnySet: [0, 1, 2, 3, 4, 5, 6, 7] } }, 4);

//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b1 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b10 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b100 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b1000 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b10000 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b111 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b11 });
//     // match({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b1 });
//     // match({ a: { $bitsAnyClear: new Uint8Array([8]) } }, { a: new Uint8Array([7]) });
//     // match({ a: { $bitsAnyClear: new Uint8Array([1]) } }, { a: new Uint8Array([0]) });
//     // match({ a: { $bitsAnyClear: new Uint8Array([1]) } }, { a: 4 });

//     // match({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0 });
//     // match({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0b10000 });
//     // match({ a: { $bitsAllClear: new Uint8Array([3]) } }, { a: new Uint8Array([4]) });
//     // match({ a: { $bitsAllClear: new Uint8Array([0, 1]) } }, { a: new Uint8Array([255]) }); // 256 should not be set for 255.
//     // match({ a: { $bitsAllClear: new Uint8Array([3]) } }, { a: 4 });

//     // match({ a: { $bitsAllClear: new Uint8Array([3]) } }, { a: 0 });
//     // match({ a: { $bitsAllSet: [0, 1, 2, 3] } }, { a: 0b1111 });
//     // match({ a: { $bitsAllSet: [0, 1, 2] } }, { a: 15 });
//     // match({ a: { $bitsAllSet: [0, 12] } }, { a: 0b1000000000001 });

//     // // $bitsAllSet - buffer
//     // match({ a: { $bitsAllSet: new Uint8Array([3]) } }, { a: new Uint8Array([3]) });
//     // match({ a: { $bitsAllSet: new Uint8Array([7]) } }, { a: new Uint8Array([15]) });
//     // match({ a: { $bitsAllSet: new Uint8Array([3]) } }, { a: 3 });
//     // match({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0b1 });
//     // match({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0b10 });
//     // match({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0b100 });
//     // match({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0b1000 });
//     // match({ a: { $bitsAnySet: [4] } }, { a: 0b10000 });
//     // // $bitsAnySet - buffer
//     // // $bitsAnySet - number
//     // nomatch({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0 });
//     // match({ a: { $bitsAnySet: new Uint8Array([3]) } }, { a: new Uint8Array([7]) });
//     // match({ a: { $bitsAnySet: new Uint8Array([15]) } }, { a: new Uint8Array([7]) });
//     // match({ a: { $bitsAnySet: new Uint8Array([3]) } }, { a: 1 });
//     // match({ a: { $in: [1, 2, 3] } }, { a: [4, 2] });
//     // match({ a: { $in: ["x", /foo/i] } }, { a: ["f", "fOo"] });
//     // match({ a: { $in: [1, null] } }, {});
//     // match({ "a.b": { $in: [1, null] } }, {});
//     // match({ "a.b": { $in: [1, null] } }, { a: {} });
//     // match({ "a.b": { $in: [1, null] } }, { a: [{ b: 5 }, {}] });
//     // nomatch({ a: { $nin: [[1], [2], [3]] } }, { a: [2] });
//     // nomatch({ a: { $nin: [{ b: 1 }, { b: 2 }, { b: 3 }] } }, { a: { b: 2 } });
//     // nomatch({ a: { $nin: [{ x: 1 }, { x: 2 }, { x: 3 }] } }, { a: [{ x: 2 }] });
//     // nomatch({ a: { $nin: [1, 2, 3] } }, { a: [4, 2] });
//     // nomatch({ "a.b": { $nin: [1, 2, 3] } }, { a: [{ b: 4 }, { b: 2 }] });
//     // nomatch({ a: { $nin: ["x", /foo/i] } }, { a: ["f", "fOo"] });
//     // match({ "a.b": { $nin: [1] } }, { a: {} });
//     // nomatch({ "a.b": { $nin: [1, null] } }, { a: [{ b: 5 }, {}] });
//     // nomatch({ a: { $size: 1 } }, { a: "2" });
//     // nomatch({ a: { $bitsAnySet: [0, 1, 2, 3] } }, { a: 0b10000 });

//     // match({ a: { $exists: 1 } }, { a: 5 });
//     // match({ a: { $exists: 0 } }, { b: 5 });
//     // match({ a: { $mod: [10, 1] } }, { a: [10, 11, 12] });
//     // match({ a: { $in: [[1], [2], [3]] } }, { a: [2] });
//     // match({ a: { $in: [{ b: 1 }, { b: 2 }, { b: 3 }] } }, { a: { b: 2 } });
//     // match({ a: { $in: [{ x: 1 }, { x: 2 }, { x: 3 }] } }, { a: [{ x: 2 }] });
//     // nomatch({ a: { $all: [] } }, { a: [] });
//     // nomatch({ a: { $all: [] } }, { a: [5] });
//     // match({ a: { $all: [/i/, /e/i] } }, { a: ["foo", "bEr", "biz"] });
//     // match({ a: { $all: [{ b: 3 }] } }, { a: [{ b: 3 }] });
//     // match({ a: { $exists: false } }, { b: 12 });
//     // match({ a: { $exists: false } }, { b: [] });
//     // match({ a: { $exists: false } }, { b: [1] });
//     // nomatch({ a: {} }, { a: { b: 12 } });
//     // nomatch({ a: { b: 12 } }, { a: [{ b: 11 }, { b: 12, c: 20 }, { b: 13 }] });
//     // nomatch({ a: { b: 12, c: 20 } }, { a: [{ b: 11 }, { b: 12 }, { c: 20 }] });
//     // match({ a: null }, { b: 12 });
//     // match({ a: null }, { a: [1, 2, null, 3] }); // tested on mongodb
//     // match({ a: { $lt: { x: [2, 3, 4] } } }, { a: { x: [1, 3, 4] } });
//     // match({ a: { $gt: { x: [2, 3, 4] } } }, { a: { x: [3, 3, 4] } });
//     // match({ a: { $gte: { x: [2, 3, 4] } } }, { a: { x: [2, 3, 4] } });
//     // match({ a: { $lte: { x: [2, 3, 4] } } }, { a: { x: [2, 3, 4] } });
//     // match({ a: { $all: [[1, 2], [1, 3]] } }, { a: [[1, 3], [1, 2], [1, 4]] });
//     // match({ a: [1, 2] }, { a: [[1, 2]] });
//     // match({ a: [1, 2] }, { a: [[3, 4], [1, 2]] });
//     nomatch({ a: { b: 12 } }, { a: { b: 12, c: 13 } });
//     nomatch({ a: { b: 12, c: 13 } }, { a: { c: 13, b: 12 } }); // tested on mongodb
//   });
//   describe("these should all match", () => {
//     // XXX blog post about what I learned while writing these tests (weird
//     // mongo edge cases)

//     // empty selectors
//     match({}, {});
//     match({}, { a: 12 });

//     // scalars
//     match(1, { _id: 1, a: "foo" });
//     nomatch(1, { _id: 2, a: "foo" });
//     match("a", { _id: "a", a: "foo" });
//     nomatch("a", { _id: "b", a: "foo" });

//     // safety
//     nomatch(undefined, {});
//     nomatch(undefined, { _id: "foo" });
//     nomatch(false, { _id: "foo" });
//     nomatch(null, { _id: "foo" });
//     nomatch({ _id: undefined }, { _id: "foo" });
//     nomatch({ _id: false }, { _id: "foo" });
//     nomatch({ _id: null }, { _id: "foo" });

//     // matching one or more keys
//     nomatch({ a: 12 }, {});
//     match({ a: 12 }, { a: 12 });
//     match({ a: 12 }, { a: 12, b: 13 });
//     match({ a: 12, b: 13 }, { a: 12, b: 13 });
//     match({ a: 12, b: 13 }, { a: 12, b: 13, c: 14 });
//     nomatch({ a: 12, b: 13, c: 14 }, { a: 12, b: 13 });
//     nomatch({ a: 12, b: 13 }, { b: 13, c: 14 });

//     match({ a: 12 }, { a: [12] });
//     match({ a: 12 }, { a: [11, 12, 13] });
//     nomatch({ a: 12 }, { a: [11, 13] });
//     match({ a: 12, b: 13 }, { a: [11, 12, 13], b: [13, 14, 15] });
//     nomatch({ a: 12, b: 13 }, { a: [11, 12, 13], b: [14, 15] });

//     // dates
//     match({ a: date1 }, { a: date1 });
//     nomatch({ a: date1 }, { a: date2 });
//     match({ a: date3 }, { a: date3 });
//     nomatch({ a: date1 }, { a: date3 });
//     nomatch({ a: date3 }, { a: date1 });
//     nomatch({ a: { $lt: date3 } }, { a: date1 });
//     nomatch({ a: { $lte: date3 } }, { a: date1 });


//     // arrays
//     match({ a: [1, 2] }, { a: [1, 2] });
//     nomatch({ a: [1, 2] }, { a: [3, 4] });
//     nomatch({ a: [1, 2] }, { a: [[[1, 2]]] });

//     // literal documents
//     match({ a: { b: 12 } }, { a: { b: 12 } });
//     nomatch({ a: { b: 12, c: 13 } }, { a: { b: 12 } });
//     match({ a: { b: 12, c: 13 } }, { a: { b: 12, c: 13 } });
//     nomatch({ a: { b: 12 } }, { a: {} });
//     match(
//       { a: { b: 12, c: [13, true, false, 2.2, "a", null, { d: 14 }] } },
//       { a: { b: 12, c: [13, true, false, 2.2, "a", null, { d: 14 }] } }
//     );
//     match({ a: { b: 12 } }, { a: { b: 12 }, k: 99 });

//     match({ a: { b: 12 } }, { a: [{ b: 12 }] });
//     nomatch({ a: { b: 12 } }, { a: [[{ b: 12 }]] });
//     match({ a: { b: 12 } }, { a: [{ b: 11 }, { b: 12 }, { b: 13 }] });
//     match({ a: { b: 12, c: 20 } }, { a: [{ b: 11 }, { b: 12, c: 20 }, { b: 13 }] });

//     // null
//     match({ a: null }, { a: null });
//     nomatch({ a: null }, { a: 12 });
//     nomatch({ a: null }, { a: [1, 2, {}, 3] }); // tested on mongodb

//     // order comparisons: $lt, $gt, $lte, $gte
//     match({ a: { $lt: 10 } }, { a: 9 });
//     nomatch({ a: { $lt: 10 } }, { a: 10 });
//     nomatch({ a: { $lt: 10 } }, { a: 11 });

//     match({ a: { $gt: 10 } }, { a: 11 });
//     nomatch({ a: { $gt: 10 } }, { a: 10 });
//     nomatch({ a: { $gt: 10 } }, { a: 9 });

//     match({ a: { $lte: 10 } }, { a: 9 });
//     match({ a: { $lte: 10 } }, { a: 10 });
//     nomatch({ a: { $lte: 10 } }, { a: 11 });

//     match({ a: { $gte: 10 } }, { a: 11 });
//     match({ a: { $gte: 10 } }, { a: 10 });
//     nomatch({ a: { $gte: 10 } }, { a: 9 });

//     match({ a: { $lt: 10 } }, { a: [11, 9, 12] });
//     nomatch({ a: { $lt: 10 } }, { a: [11, 12] });

//     // (there's a full suite of ordering test elsewhere)
//     nomatch({ a: { $lt: "null" } }, { a: null });
//     nomatch({ a: { $gt: { x: [2, 3, 4] } } }, { a: { x: [1, 3, 4] } });
//     nomatch({ a: { $gt: { x: [2, 3, 4] } } }, { a: { x: [2, 3, 4] } });
//     nomatch({ a: { $lt: { x: [2, 3, 4] } } }, { a: { x: [2, 3, 4] } });

//     nomatch({ a: { $gt: [2, 3] } }, { a: [1, 2] }); // tested against mongodb

//     // composition of two qualifiers
//     nomatch({ a: { $lt: 11, $gt: 9 } }, { a: 8 });
//     nomatch({ a: { $lt: 11, $gt: 9 } }, { a: 9 });
//     match({ a: { $lt: 11, $gt: 9 } }, { a: 10 });
//     nomatch({ a: { $lt: 11, $gt: 9 } }, { a: 11 });
//     nomatch({ a: { $lt: 11, $gt: 9 } }, { a: 12 });

//     match({ a: { $lt: 11, $gt: 9 } }, { a: [8, 9, 10, 11, 12] });
//     match({ a: { $lt: 11, $gt: 9 } }, { a: [8, 9, 11, 12] }); // tested against mongodb

//     // $all
//     match({ a: { $all: [1, 2] } }, { a: [1, 2] });
//     nomatch({ a: { $all: [1, 2, 3] } }, { a: [1, 2] });
//     match({ a: { $all: [1, 2] } }, { a: [3, 2, 1] });
//     match({ a: { $all: [1, "x"] } }, { a: [3, "x", 1] });
//     nomatch({ a: { $all: ["2"] } }, { a: 2 });
//     nomatch({ a: { $all: [2] } }, { a: "2" });
//     nomatch({ a: { $all: [[1, 2], [1, 3]] } }, { a: [[1, 4], [1, 2], [1, 4]] });
//     match({ a: { $all: [2, 2] } }, { a: [2] }); // tested against mongodb
//     nomatch({ a: { $all: [2, 3] } }, { a: [2, 2] });

//     nomatch({ a: { $all: [1, 2] } }, { a: [[1, 2]] }); // tested against mongodb
//     nomatch({ a: { $all: [1, 2] } }, {}); // tested against mongodb, field doesn't exist
//     nomatch({ a: { $all: [1, 2] } }, { a: { foo: "bar" } }); // tested against mongodb, field is not an object
//     nomatch({ a: { $all: [/i/, /e/i] } }, { a: ["foo", "bar", "biz"] });
//     // Members of $all other than regexps are *equality matches*, not document
//     // matches.
//     nomatch({ a: { $all: [{ b: 3 }] } }, { a: [{ b: 3, k: 4 }] });
//     throws(() => {
//       match({ a: { $all: [{ $gt: 4 }] } }, {});
//     });

//     // $exists
//     match({ a: { $exists: true } }, { a: 12 });
//     nomatch({ a: { $exists: true } }, { b: 12 });
//     nomatch({ a: { $exists: false } }, { a: 12 });

//     match({ a: { $exists: true } }, { a: [] });
//     nomatch({ a: { $exists: true } }, { b: [] });
//     nomatch({ a: { $exists: false } }, { a: [] });

//     match({ a: { $exists: true } }, { a: [1] });
//     nomatch({ a: { $exists: true } }, { b: [1] });
//     nomatch({ a: { $exists: false } }, { a: [1] });

//     nomatch({ "a.x": { $exists: false } }, { a: [{}, { x: 5 }] });
//     match({ "a.x": { $exists: true } }, { a: [{}, { x: 5 }] });
//     match({ "a.x": { $exists: true } }, { a: [{}, { x: 5 }] });
//     match({ "a.x": { $exists: true } }, { a: { x: [] } });
//     match({ "a.x": { $exists: true } }, { a: { x: null } });

//     // $mod
//     match({ a: { $mod: [10, 1] } }, { a: 11 });
//     nomatch({ a: { $mod: [10, 1] } }, { a: 12 });
//     nomatch({ a: { $mod: [10, 1] } }, { a: [10, 12] });
//     [
//       5,
//       [10],
//       [10, 1, 2],
//       "foo",
//       { bar: 1 },
//       []
//     ].forEach((badMod) => {
//       throws(() => {
//         match({ a: { $mod: badMod } }, { a: 11 });
//       });
//     });

//     // $eq
//     nomatch({ a: { $eq: 1 } }, { a: 2 });
//     match({ a: { $eq: 2 } }, { a: 2 });
//     nomatch({ a: { $eq: [1] } }, { a: [2] });

//     match({ a: { $eq: [1, 2] } }, { a: [1, 2] });
//     match({ a: { $eq: 1 } }, { a: [1, 2] });
//     match({ a: { $eq: 2 } }, { a: [1, 2] });
//     nomatch({ a: { $eq: 3 } }, { a: [1, 2] });
//     match({ "a.b": { $eq: 1 } }, { a: [{ b: 1 }, { b: 2 }] });
//     match({ "a.b": { $eq: 2 } }, { a: [{ b: 1 }, { b: 2 }] });
//     nomatch({ "a.b": { $eq: 3 } }, { a: [{ b: 1 }, { b: 2 }] });

//     match({ a: { $eq: { x: 1 } } }, { a: { x: 1 } });
//     nomatch({ a: { $eq: { x: 1 } } }, { a: { x: 2 } });
//     nomatch({ a: { $eq: { x: 1 } } }, { a: { x: 1, y: 2 } });

//     // $ne
//     match({ a: { $ne: 1 } }, { a: 2 });
//     nomatch({ a: { $ne: 2 } }, { a: 2 });
//     match({ a: { $ne: [1] } }, { a: [2] });

//     nomatch({ a: { $ne: [1, 2] } }, { a: [1, 2] }); // all tested against mongodb
//     nomatch({ a: { $ne: 1 } }, { a: [1, 2] });
//     nomatch({ a: { $ne: 2 } }, { a: [1, 2] });
//     match({ a: { $ne: 3 } }, { a: [1, 2] });
//     nomatch({ "a.b": { $ne: 1 } }, { a: [{ b: 1 }, { b: 2 }] });
//     nomatch({ "a.b": { $ne: 2 } }, { a: [{ b: 1 }, { b: 2 }] });
//     match({ "a.b": { $ne: 3 } }, { a: [{ b: 1 }, { b: 2 }] });

//     nomatch({ a: { $ne: { x: 1 } } }, { a: { x: 1 } });
//     match({ a: { $ne: { x: 1 } } }, { a: { x: 2 } });
//     match({ a: { $ne: { x: 1 } } }, { a: { x: 1, y: 2 } });

//     // This query means: All 'a.b' must be non-5, and some 'a.b' must be >6.
//     match({ "a.b": { $ne: 5, $gt: 6 } }, { a: [{ b: 2 }, { b: 10 }] });
//     nomatch({ "a.b": { $ne: 5, $gt: 6 } }, { a: [{ b: 2 }, { b: 4 }] });
//     nomatch({ "a.b": { $ne: 5, $gt: 6 } }, { a: [{ b: 2 }, { b: 5 }] });
//     nomatch({ "a.b": { $ne: 5, $gt: 6 } }, { a: [{ b: 10 }, { b: 5 }] });
//     // Should work the same if the branch is at the bottom.
//     match({ a: { $ne: 5, $gt: 6 } }, { a: [2, 10] });
//     nomatch({ a: { $ne: 5, $gt: 6 } }, { a: [2, 4] });
//     nomatch({ a: { $ne: 5, $gt: 6 } }, { a: [2, 5] });
//     nomatch({ a: { $ne: 5, $gt: 6 } }, { a: [10, 5] });

//     // $in
//     match({ a: { $in: [1, 2, 3] } }, { a: 2 });
//     nomatch({ a: { $in: [1, 2, 3] } }, { a: 4 });
//     nomatch({ a: { $in: [[1], [2], [3]] } }, { a: [4] });
//     nomatch({ a: { $in: [{ b: 1 }, { b: 2 }, { b: 3 }] } }, { a: { b: 4 } });

//     match({ a: { $in: [1, 2, 3] } }, { a: [2] }); // tested against mongodb
//     nomatch({ a: { $in: [1, 2, 3] } }, { a: [4] });

//     match({ a: { $in: ["x", /foo/i] } }, { a: "x" });
//     match({ a: { $in: ["x", /foo/i] } }, { a: "fOo" });
//     nomatch({ a: { $in: ["x", /foo/i] } }, { a: ["f", "fOx"] });

//     match({ "a.b": { $in: [1, null] } }, { a: { b: null } });
//     nomatch({ "a.b": { $in: [1, null] } }, { a: { b: 5 } });
//     nomatch({ "a.b": { $in: [1] } }, { a: { b: null } });
//     nomatch({ "a.b": { $in: [1] } }, { a: {} });
//     nomatch({ "a.b": { $in: [1, null] } }, { a: [{ b: 5 }] });
//     nomatch({ "a.b": { $in: [1, null] } }, { a: [{ b: 5 }, []] });
//     nomatch({ "a.b": { $in: [1, null] } }, { a: [{ b: 5 }, 5] });

//     // $nin
//     nomatch({ a: { $nin: [1, 2, 3] } }, { a: 2 });
//     match({ a: { $nin: [1, 2, 3] } }, { a: 4 });
//     match({ a: { $nin: [[1], [2], [3]] } }, { a: [4] });
//     match({ a: { $nin: [{ b: 1 }, { b: 2 }, { b: 3 }] } }, { a: { b: 4 } });

//     nomatch({ a: { $nin: [1, 2, 3] } }, { a: [2] }); // tested against mongodb
//     match({ a: { $nin: [1, 2, 3] } }, { a: [4] });
//     match({ "a.b": { $nin: [1, 2, 3] } }, { a: [{ b: 4 }] });

//     nomatch({ a: { $nin: ["x", /foo/i] } }, { a: "x" });
//     nomatch({ a: { $nin: ["x", /foo/i] } }, { a: "fOo" });
//     match({ a: { $nin: ["x", /foo/i] } }, { a: ["f", "fOx"] });

//     nomatch({ a: { $nin: [1, null] } }, {});
//     nomatch({ "a.b": { $nin: [1, null] } }, {});
//     nomatch({ "a.b": { $nin: [1, null] } }, { a: {} });
//     nomatch({ "a.b": { $nin: [1, null] } }, { a: { b: null } });
//     match({ "a.b": { $nin: [1, null] } }, { a: { b: 5 } });
//     match({ "a.b": { $nin: [1] } }, { a: { b: null } });
//     match({ "a.b": { $nin: [1, null] } }, { a: [{ b: 5 }] });
//     match({ "a.b": { $nin: [1, null] } }, { a: [{ b: 5 }, []] });
//     match({ "a.b": { $nin: [1, null] } }, { a: [{ b: 5 }, 5] });

//     // $size
//     match({ a: { $size: 0 } }, { a: [] });
//     match({ a: { $size: 1 } }, { a: [2] });
//     match({ a: { $size: 2 } }, { a: [2, 2] });
//     nomatch({ a: { $size: 0 } }, { a: [2] });
//     nomatch({ a: { $size: 1 } }, { a: [] });
//     nomatch({ a: { $size: 1 } }, { a: [2, 2] });
//     nomatch({ a: { $size: 0 } }, { a: "2" });
//     nomatch({ a: { $size: 2 } }, { a: "2" });

//     nomatch({ a: { $size: 2 } }, { a: [[2, 2]] }); // tested against mongodb


//     // $bitsAllClear - number
//     nomatch({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0b1 });
//     nomatch({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0b10 });
//     nomatch({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0b100 });
//     nomatch({ a: { $bitsAllClear: [0, 1, 2, 3] } }, { a: 0b1000 });

//     // $bitsAllClear - buffer

//     // $bitsAllSet - number
//     nomatch({ a: { $bitsAllSet: [0, 1, 2, 3] } }, { a: 0b111 });
//     nomatch({ a: { $bitsAllSet: [0, 1, 2, 3] } }, { a: 256 });
//     nomatch({ a: { $bitsAllSet: [0, 1, 2, 3] } }, { a: 50000 });
//     nomatch({ a: { $bitsAllSet: [0, 12] } }, { a: 0b1000000000000 });
//     nomatch({ a: { $bitsAllSet: [0, 12] } }, { a: 0b1 });



//     // $bitsAnyClear - number
//     nomatch({ a: { $bitsAnyClear: [0, 1, 2, 3] } }, { a: 0b1111 });
//     nomatch({ a: { $bitsAnyClear: [0, 1, 2] } }, { a: 0b111 });
//     nomatch({ a: { $bitsAnyClear: [0, 1] } }, { a: 0b11 });
//     nomatch({ a: { $bitsAnyClear: [0] } }, { a: 0b1 });
//     nomatch({ a: { $bitsAnyClear: [4] } }, { a: 0b10000 });

//     // $bitsAnyClear - buffer
//     // taken from: https://github.com/mongodb/mongo/blob/master/jstests/core/bittest.js


//     // Tests on numbers.
//     c.insertOne({ a: 0 });
//     c.insertOne({ a: 1 });
//     c.insertOne({ a: 54 });
//     c.insertOne({ a: 88 });
//     c.insertOne({ a: 255 });

//     // Tests with bitmask.
//     matchCount({ a: { $bitsAnySet: 0 } }, 0);
//     matchCount({ a: { $bitsAnyClear: 0 } }, 0);
//     matchCount({ a: { $bitsAnySet: [] } }, 0);
//     matchCount({ a: { $bitsAnyClear: [] } }, 0);
//     matchCount({ a: { $bitsAnySet: 0 } }, 0);
//     matchCount({ a: { $bitsAnyClear: 0 } }, 0);
//     matchCount({ a: { $bitsAnySet: [] } }, 0);
//     matchCount({ a: { $bitsAnyClear: [] } }, 0);

//     // Tests with multiple predicates.

//     // Tests on BinData.

//     c.deleteMany({});

//     c.deleteMany({});

//     nomatch({ a: { $bitsAllSet: 1 } }, { a: false });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: NaN });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: Infinity });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: null });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: "asdf" });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: ["a", "b"] });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: { foo: "bar" } });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: 1.2 });
//     nomatch({ a: { $bitsAllSet: 1 } }, { a: "1" });

//     [
//       false,
//       NaN,
//       Infinity,
//       null,
//       "asdf",
//       ["a", "b"],
//       { foo: "bar" },
//       1.2,
//       "1",
//       [0, -1]
//     ].forEach((badValue) => {
//       throws(() => {
//         match({ a: { $bitsAllSet: badValue } }, { a: 42 });
//       });
//     });

//     // $type
//     match({ a: { $type: "string" } }, { a: "1" });
//     match({ a: { $type: "object" } }, { a: {} });
//     nomatch({ a: { $type: 8 } }, {});
//     match({ a: { $type: "date" } }, { a: new Date() });
//     match({ a: { $type: "null" } }, { a: null });
//     nomatch({ a: { $type: 11 } }, {});

//     // The normal rule for {$type:4} (4 means array) is that it NOT good enough to
//     // just have an array that's the leaf that matches the path.  (An array inside
//     // that array is good, though.)
//     match({ "a.0": { $type: "array" } }, { a: [[0]] });

//     // invalid types should throw errors
//     throws(() => {
//       match({ a: { $type: "foo" } }, { a: 1 });
//     });
//     throws(() => {
//       match({ a: { $type: -2 } }, { a: 1 });
//     });
//     throws(() => {
//       match({ a: { $type: 0 } }, { a: 1 });
//     });
//     throws(() => {
//       match({ a: { $type: 20 } }, { a: 1 });
//     });

//     // regular expressions
//     // match({ a: /a/ }, { a: "cat" });
//     // nomatch({ a: /a/ }, { a: "cut" });
//     // nomatch({ a: /a/ }, { a: "CAT" });
//     // match({ a: /a/i }, { a: "CAT" });
//     // match({ a: /a/ }, { a: ["foo", "bar"] }); // search within array...
//     // match({ a: { $regex: /a/ } }, { a: "cat" });
//     // nomatch({ a: { $regex: /a/ } }, { a: "cut" });
//     // nomatch({ a: { $regex: /a/ } }, { a: "CAT" });
//     // match({ a: { $regex: /a/i } }, { a: "CAT" });
//     nomatch({ a: { $regex: /a/i, $options: "" } }, { a: "CAT" }); // tested
//     // nomatch({ a: { $regex: "", $options: "i" } }, {});
//     // nomatch({ a: /undefined/ }, {});
//     // nomatch({ a: { $regex: "undefined" } }, {});
//     // nomatch({ a: /xxx/ }, {});
//     // nomatch({ a: { $regex: "xxx" } }, {});


//     throws(() => {
//       match({ a: { $options: "i" } }, { a: 12 });
//     });

//     match({ a: /a/ }, { a: ["dog", "cat"] });
//     nomatch({ a: /a/ }, { a: ["dog", "puppy"] });

//     // we don't support regexps in minimongo very well (eg, there's no EJSON
//     // encoding so it won't go over the wire), but run these tests anyway
//     match({ a: /a/ }, { a: /a/ });
//     match({ a: /a/ }, { a: ["x", /a/] });
//     nomatch({ a: /a/ }, { a: /b/ });
//     match({ a: /m/i }, { a: ["x", "xM"] });

//     throws(() => {
//       match({ a: { $regex: /a/, $options: "x" } }, { a: "cat" });
//     });
//     throws(() => {
//       match({ a: { $regex: /a/, $options: "s" } }, { a: "cat" });
//     });

//     // $not
//     match({ x: { $not: { $gt: 7 } } }, { x: 6 });
//     nomatch({ x: { $not: { $gt: 7 } } }, { x: 8 });
//     nomatch({ x: { $not: { $lt: 10, $gt: 7 } } }, { x: 9 });

//     match({ x: { $not: { $gt: 7 } } }, { x: [2, 3, 4] });
//     match({ "x.y": { $not: { $gt: 7 } } }, { x: [{ y: 2 }, { y: 3 }, { y: 4 }] });
//     nomatch({ x: { $not: { $gt: 7 } } }, { x: [2, 3, 4, 10] });
//     nomatch({ "x.y": { $not: { $gt: 7 } } }, { x: [{ y: 2 }, { y: 3 }, { y: 4 }, { y: 10 }] });

//     match({ x: { $not: /a/ } }, { x: "dog" });
//     nomatch({ x: { $not: /a/ } }, { x: "cat" });
//     match({ x: { $not: /a/ } }, { x: ["dog", "puppy"] });
//     nomatch({ x: { $not: /a/ } }, { x: ["kitten", "cat"] });

//     // dotted keypaths: bare values
//     match({ "a.b": 1 }, { a: { b: 1 } });
//     nomatch({ "a.b": 1 }, { a: { b: 2 } });
//     match({ "a.b": [1, 2, 3] }, { a: { b: [1, 2, 3] } });
//     nomatch({ "a.b": [1, 2, 3] }, { a: { b: [4] } });
//     match({ "a.b": /a/ }, { a: { b: "cat" } });
//     nomatch({ "a.b": /a/ }, { a: { b: "dog" } });

//     // dotted keypaths, nulls, numeric indices, arrays
//     nomatch({ "a.b": null }, { a: [1] });
//     match({ "a.b": [] }, { a: { b: [] } });
//     const big = { a: [{ b: 1 }, 2, {}, { b: [3, 4] }] };
//     match({ "a.b": 1 }, big);
//     match({ "a.1": 8 }, { a: [7, 8, 9] });
//     nomatch({ "a.1": 7 }, { a: [7, 8, 9] });
//     nomatch({ "a.1": null }, { a: [7, 8, 9] });
//     match({ "a.1": [8, 9] }, { a: [7, [8, 9]] });
//     nomatch({ "a.1": 6 }, { a: [[6, 7], [8, 9]] });
//     nomatch({ "a.1": 7 }, { a: [[6, 7], [8, 9]] });
//     match({ "a.1": { 1: 2 } }, { a: [0, { 1: 2 }, 3] });
//     match({ "x.1.y": 8 }, { x: [7, { y: 8 }, 9] });
//     // comes from trying '1' as key in the plain object
//     match({ "a.1.b": 9 }, { a: [7, { b: 9 }, { 1: { b: "foo" } }] });
//     match({ "a.1.b": 2 }, { a: [1, [{ b: 2 }], 3] });
//     nomatch({ "a.1.b": null }, { a: [1, [{ b: 2 }], 3] });
//     // this is new behavior in mongo 2.5
//     nomatch({ "a.0.b": null }, { a: [5] });
//     match({ "a.1": 5 }, { a: [{ 1: 4 }, 5] });
//     nomatch({ "a.1": null }, { a: [{ 1: 4 }, 5] });
//     match({ "a.1.foo": 5 }, { a: [{ 1: { foo: 4 } }, { foo: 5 }] });

//     // trying to access a dotted field that is undefined at some point
//     // down the chain
//     nomatch({ "a.b": 1 }, { x: 2 });
//     nomatch({ "a.b.c": 1 }, { a: { x: 2 } });
//     nomatch({ "a.b.c": 1 }, { a: { b: { x: 2 } } });
//     nomatch({ "a.b.c": 1 }, { a: { b: 1 } });
//     nomatch({ "a.b.c": 1 }, { a: { b: 0 } });

//     // dotted keypaths: literal objects
//     match({ "a.b": { c: 1 } }, { a: { b: { c: 1 } } });
//     nomatch({ "a.b": { c: 1 } }, { a: { b: { c: 2 } } });
//     nomatch({ "a.b": { c: 1 } }, { a: { b: 2 } });
//     match({ "a.b": { c: 1, d: 2 } }, { a: { b: { c: 1, d: 2 } } });
//     nomatch({ "a.b": { c: 1, d: 2 } }, { a: { b: { c: 1, d: 1 } } });
//     nomatch({ "a.b": { c: 1, d: 2 } }, { a: { b: { d: 2 } } });

//     // dotted keypaths: $ operators
//     match({ "a.b": { $in: [1, 2, 3] } }, { a: { b: [2] } }); // tested against mongodb
//     nomatch({ "a.b": { $in: [1, 2, 3] } }, { a: { b: [4] } });

//     // $or
//     throws(() => {
//       match({ $or: [] }, {});
//     });
//     throws(() => {
//       match({ $or: [5] }, {});
//     });
//     throws(() => {
//       match({ $or: [] }, { a: 1 });
//     });
//     match({ $or: [{ a: 1 }] }, { a: 1 });
//     nomatch({ $or: [{ b: 2 }] }, { a: 1 });
//     match({ $or: [{ a: 1 }, { b: 2 }] }, { a: 1 });
//     nomatch({ $or: [{ c: 3 }, { d: 4 }] }, { a: 1 });
//     match({ $or: [{ a: 1 }, { b: 2 }] }, { a: [1, 2, 3] });
//     nomatch({ $or: [{ a: 1 }, { b: 2 }] }, { c: [1, 2, 3] });
//     nomatch({ $or: [{ a: 1 }, { b: 2 }] }, { a: [2, 3, 4] });
//     match({ $or: [{ a: 1 }, { a: 2 }] }, { a: 1 });
//     match({ $or: [{ a: 1 }, { a: 2 }], b: 2 }, { a: 1, b: 2 });
//     nomatch({ $or: [{ a: 2 }, { a: 3 }], b: 2 }, { a: 1, b: 2 });
//     nomatch({ $or: [{ a: 1 }, { a: 2 }], b: 3 }, { a: 1, b: 2 });

//     // Combining $or with equality
//     match({ x: 1, $or: [{ a: 1 }, { b: 1 }] }, { x: 1, b: 1 });
//     match({ $or: [{ a: 1 }, { b: 1 }], x: 1 }, { x: 1, b: 1 });
//     nomatch({ x: 1, $or: [{ a: 1 }, { b: 1 }] }, { b: 1 });
//     nomatch({ x: 1, $or: [{ a: 1 }, { b: 1 }] }, { x: 1 });

//     // $or and $lt, $lte, $gt, $gte
//     match({ $or: [{ a: { $lte: 1 } }, { a: 2 }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $lt: 1 } }, { a: 2 }] }, { a: 1 });
//     match({ $or: [{ a: { $gte: 1 } }, { a: 2 }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $gt: 1 } }, { a: 2 }] }, { a: 1 });
//     match({ $or: [{ b: { $gt: 1 } }, { b: { $lt: 3 } }] }, { b: 2 });
//     nomatch({ $or: [{ b: { $lt: 1 } }, { b: { $gt: 3 } }] }, { b: 2 });

//     // $or and $in
//     match({ $or: [{ a: { $in: [1, 2, 3] } }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $in: [4, 5, 6] } }] }, { a: 1 });
//     match({ $or: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { a: 1 });
//     match({ $or: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { b: 2 });
//     nomatch({ $or: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { c: 3 });
//     match({ $or: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [1, 2, 3] } }] }, { b: 2 });
//     nomatch({ $or: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [4, 5, 6] } }] }, { b: 2 });

//     // $or and $nin
//     nomatch({ $or: [{ a: { $nin: [1, 2, 3] } }] }, { a: 1 });
//     match({ $or: [{ a: { $nin: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { a: 1 });
//     match({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { b: 2 });
//     nomatch({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [1, 2, 3] } }] }, { a: 1, b: 2 });
//     match({ $or: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [4, 5, 6] } }] }, { b: 2 });

//     // $or and dot-notation
//     match({ $or: [{ "a.b": 1 }, { "a.b": 2 }] }, { a: { b: 1 } });
//     match({ $or: [{ "a.b": 1 }, { "a.c": 1 }] }, { a: { b: 1 } });
//     nomatch({ $or: [{ "a.b": 2 }, { "a.c": 1 }] }, { a: { b: 1 } });

//     // $or and nested objects
//     match({ $or: [{ a: { b: 1, c: 2 } }, { a: { b: 2, c: 1 } }] }, { a: { b: 1, c: 2 } });

//     // $or and regexes
//     match({ $or: [{ a: /a/ }] }, { a: "cat" });
//     nomatch({ $or: [{ a: /o/ }] }, { a: "cat" });
//     match({ $or: [{ a: /a/ }, { a: /o/ }] }, { a: "cat" });
//     nomatch({ $or: [{ a: /i/ }, { a: /o/ }] }, { a: "cat" });
//     match({ $or: [{ a: /i/ }, { b: /o/ }] }, { a: "cat", b: "dog" });

//     // $or and $ne
//     nomatch({ $or: [{ a: { $ne: 1 } }] }, { a: 1 });
//     match({ $or: [{ a: { $ne: 1 } }] }, { a: 2 });
//     match({ $or: [{ a: { $ne: 1 } }, { a: { $ne: 2 } }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $ne: 1 } }, { b: { $ne: 2 } }] }, { a: 1, b: 2 });

//     // $or and $not
//     match({ $or: [{ a: { $not: { $mod: [10, 1] } } }] }, {});
//     nomatch({ $or: [{ a: { $not: { $mod: [10, 1] } } }] }, { a: 1 });
//     match({ $or: [{ a: { $not: { $mod: [10, 1] } } }] }, { a: 2 });
//     match({ $or: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $not: { $mod: [10, 2] } } }] }, { a: 1 });
//     nomatch({ $or: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 1 });
//     match({ $or: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 2 });
//     match({ $or: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 3 });
//     // this is possibly an open-ended task, so we stop here ...

//     // $nor
//     throws(() => {
//       match({ $nor: [] }, {});
//     });
//     throws(() => {
//       match({ $nor: [5] }, {});
//     });
//     throws(() => {
//       match({ $nor: [] }, { a: 1 });
//     });
//     nomatch({ $nor: [{ a: 1 }] }, { a: 1 });
//     match({ $nor: [{ b: 2 }] }, { a: 1 });
//     nomatch({ $nor: [{ a: 1 }, { b: 2 }] }, { a: 1 });
//     match({ $nor: [{ c: 3 }, { d: 4 }] }, { a: 1 });
//     nomatch({ $nor: [{ a: 1 }, { b: 2 }] }, { a: [1, 2, 3] });
//     match({ $nor: [{ a: 1 }, { b: 2 }] }, { c: [1, 2, 3] });
//     match({ $nor: [{ a: 1 }, { b: 2 }] }, { a: [2, 3, 4] });
//     nomatch({ $nor: [{ a: 1 }, { a: 2 }] }, { a: 1 });

//     // $nor and $lt, $lte, $gt, $gte
//     nomatch({ $nor: [{ a: { $lte: 1 } }, { a: 2 }] }, { a: 1 });
//     match({ $nor: [{ a: { $lt: 1 } }, { a: 2 }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $gte: 1 } }, { a: 2 }] }, { a: 1 });
//     match({ $nor: [{ a: { $gt: 1 } }, { a: 2 }] }, { a: 1 });
//     nomatch({ $nor: [{ b: { $gt: 1 } }, { b: { $lt: 3 } }] }, { b: 2 });
//     match({ $nor: [{ b: { $lt: 1 } }, { b: { $gt: 3 } }] }, { b: 2 });

//     // $nor and $in
//     nomatch({ $nor: [{ a: { $in: [1, 2, 3] } }] }, { a: 1 });
//     match({ $nor: [{ a: { $in: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { b: 2 });
//     match({ $nor: [{ a: { $in: [1, 2, 3] } }, { b: 2 }] }, { c: 3 });
//     nomatch({ $nor: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [1, 2, 3] } }] }, { b: 2 });
//     match({ $nor: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [4, 5, 6] } }] }, { b: 2 });

//     // $nor and $nin
//     match({ $nor: [{ a: { $nin: [1, 2, 3] } }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $nin: [4, 5, 6] } }] }, { a: 1 });
//     match({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: 2 }] }, { b: 2 });
//     match({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [1, 2, 3] } }] }, { a: 1, b: 2 });
//     nomatch({ $nor: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [4, 5, 6] } }] }, { b: 2 });

//     // $nor and dot-notation
//     nomatch({ $nor: [{ "a.b": 1 }, { "a.b": 2 }] }, { a: { b: 1 } });
//     nomatch({ $nor: [{ "a.b": 1 }, { "a.c": 1 }] }, { a: { b: 1 } });
//     match({ $nor: [{ "a.b": 2 }, { "a.c": 1 }] }, { a: { b: 1 } });

//     // $nor and nested objects
//     nomatch({ $nor: [{ a: { b: 1, c: 2 } }, { a: { b: 2, c: 1 } }] }, { a: { b: 1, c: 2 } });

//     // $nor and regexes
//     nomatch({ $nor: [{ a: /a/ }] }, { a: "cat" });
//     match({ $nor: [{ a: /o/ }] }, { a: "cat" });
//     nomatch({ $nor: [{ a: /a/ }, { a: /o/ }] }, { a: "cat" });
//     match({ $nor: [{ a: /i/ }, { a: /o/ }] }, { a: "cat" });
//     nomatch({ $nor: [{ a: /i/ }, { b: /o/ }] }, { a: "cat", b: "dog" });

//     // $nor and $ne
//     match({ $nor: [{ a: { $ne: 1 } }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $ne: 1 } }] }, { a: 2 });
//     nomatch({ $nor: [{ a: { $ne: 1 } }, { a: { $ne: 2 } }] }, { a: 1 });
//     match({ $nor: [{ a: { $ne: 1 } }, { b: { $ne: 2 } }] }, { a: 1, b: 2 });

//     // $nor and $not
//     nomatch({ $nor: [{ a: { $not: { $mod: [10, 1] } } }] }, {});
//     match({ $nor: [{ a: { $not: { $mod: [10, 1] } } }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $not: { $mod: [10, 1] } } }] }, { a: 2 });
//     nomatch({ $nor: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $not: { $mod: [10, 2] } } }] }, { a: 1 });
//     match({ $nor: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 1 });
//     nomatch({ $nor: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 2 });
//     nomatch({ $nor: [{ a: { $not: { $mod: [10, 1] } } }, { a: { $mod: [10, 2] } }] }, { a: 3 });

//     // $and

//     throws(() => {
//       match({ $and: [] }, {});
//     });
//     throws(() => {
//       match({ $and: [5] }, {});
//     });
//     throws(() => {
//       match({ $and: [] }, { a: 1 });
//     });
//     match({ $and: [{ a: 1 }] }, { a: 1 });
//     nomatch({ $and: [{ a: 1 }, { a: 2 }] }, { a: 1 });
//     nomatch({ $and: [{ a: 1 }, { b: 1 }] }, { a: 1 });
//     match({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1, b: 2 });
//     nomatch({ $and: [{ a: 1 }, { b: 1 }] }, { a: 1, b: 2 });
//     match({ $and: [{ a: 1 }, { b: 2 }], c: 3 }, { a: 1, b: 2, c: 3 });
//     nomatch({ $and: [{ a: 1 }, { b: 2 }], c: 4 }, { a: 1, b: 2, c: 3 });

//     // $and and regexes
//     match({ $and: [{ a: /a/ }] }, { a: "cat" });
//     match({ $and: [{ a: /a/i }] }, { a: "CAT" });
//     nomatch({ $and: [{ a: /o/ }] }, { a: "cat" });
//     nomatch({ $and: [{ a: /a/ }, { a: /o/ }] }, { a: "cat" });
//     match({ $and: [{ a: /a/ }, { b: /o/ }] }, { a: "cat", b: "dog" });
//     nomatch({ $and: [{ a: /a/ }, { b: /a/ }] }, { a: "cat", b: "dog" });

//     // $and, dot-notation, and nested objects
//     match({ $and: [{ "a.b": 1 }] }, { a: { b: 1 } });
//     match({ $and: [{ a: { b: 1 } }] }, { a: { b: 1 } });
//     nomatch({ $and: [{ "a.b": 2 }] }, { a: { b: 1 } });
//     nomatch({ $and: [{ "a.c": 1 }] }, { a: { b: 1 } });
//     nomatch({ $and: [{ "a.b": 1 }, { "a.b": 2 }] }, { a: { b: 1 } });
//     nomatch({ $and: [{ "a.b": 1 }, { a: { b: 2 } }] }, { a: { b: 1 } });
//     match({ $and: [{ "a.b": 1 }, { "c.d": 2 }] }, { a: { b: 1 }, c: { d: 2 } });
//     nomatch({ $and: [{ "a.b": 1 }, { "c.d": 1 }] }, { a: { b: 1 }, c: { d: 2 } });
//     match({ $and: [{ "a.b": 1 }, { c: { d: 2 } }] }, { a: { b: 1 }, c: { d: 2 } });
//     nomatch({ $and: [{ "a.b": 1 }, { c: { d: 1 } }] }, { a: { b: 1 }, c: { d: 2 } });
//     nomatch({ $and: [{ "a.b": 2 }, { c: { d: 2 } }] }, { a: { b: 1 }, c: { d: 2 } });
//     match({ $and: [{ a: { b: 1 } }, { c: { d: 2 } }] }, { a: { b: 1 }, c: { d: 2 } });
//     nomatch({ $and: [{ a: { b: 2 } }, { c: { d: 2 } }] }, { a: { b: 1 }, c: { d: 2 } });

//     // $and and $in
//     nomatch({ $and: [{ a: { $in: [] } }] }, {});
//     match({ $and: [{ a: { $in: [1, 2, 3] } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $in: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $in: [1, 2, 3] } }, { a: { $in: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [1, 2, 3] } }] }, { a: 1, b: 4 });
//     match({ $and: [{ a: { $in: [1, 2, 3] } }, { b: { $in: [4, 5, 6] } }] }, { a: 1, b: 4 });


//     // $and and $nin
//     nomatch({ $and: [{ a: { $nin: [1, 2, 3] } }] }, { a: 1 });
//     match({ $and: [{ a: { $nin: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $nin: [1, 2, 3] } }, { a: { $nin: [4, 5, 6] } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [1, 2, 3] } }] }, { a: 1, b: 4 });
//     nomatch({ $and: [{ a: { $nin: [1, 2, 3] } }, { b: { $nin: [4, 5, 6] } }] }, { a: 1, b: 4 });

//     // $and and $lt, $lte, $gt, $gte
//     match({ $and: [{ a: { $lt: 2 } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $lt: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $lte: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $gt: 0 } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $gt: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $gte: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $gt: 0 } }, { a: { $lt: 2 } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $gt: 1 } }, { a: { $lt: 2 } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $gt: 0 } }, { a: { $lt: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $gte: 1 } }, { a: { $lte: 1 } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $gte: 2 } }, { a: { $lte: 0 } }] }, { a: 1 });

//     // $and and $ne
//     nomatch({ $and: [{ a: { $ne: 1 } }] }, { a: 1 });
//     match({ $and: [{ a: { $ne: 1 } }] }, { a: 2 });
//     nomatch({ $and: [{ a: { $ne: 1 } }, { a: { $ne: 2 } }] }, { a: 2 });
//     match({ $and: [{ a: { $ne: 1 } }, { a: { $ne: 3 } }] }, { a: 2 });

//     // $and and $not
//     match({ $and: [{ a: { $not: { $gt: 2 } } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $not: { $lt: 2 } } }] }, { a: 1 });
//     match({ $and: [{ a: { $not: { $lt: 0 } } }, { a: { $not: { $gt: 2 } } }] }, { a: 1 });
//     nomatch({ $and: [{ a: { $not: { $lt: 2 } } }, { a: { $not: { $gt: 0 } } }] }, { a: 1 });

//     // $where
//     match({ $where: "this.a === 1" }, { a: 1 });
//     nomatch({ $where: "this.a !== 1" }, { a: 1 });
//     nomatch({ $where: "this.a === 1", a: 2 }, { a: 1 });
//     match({ $where: "this.a === 1", b: 2 }, { a: 1, b: 2 });
//     match({ $where: "this.a === 1 && this.b === 2" }, { a: 1, b: 2 });
//     match({ $where: "this.a instanceof Array" }, { a: [] });
//     nomatch({ $where: "this.a instanceof Array" }, { a: 1 });

//     // reaching into array
//     match({ "dogs.0.name": "Fido" }, { dogs: [{ name: "Fido" }, { name: "Rex" }] });
//     match({ "dogs.1.name": "Rex" }, { dogs: [{ name: "Fido" }, { name: "Rex" }] });
//     nomatch({ "dogs.1.name": "Fido" }, { dogs: [{ name: "Fido" }, { name: "Rex" }] });
//     match({ "room.1b": "bla" }, { room: { "1b": "bla" } });

//     match({ "dogs.name": "Fido" }, { dogs: [{ name: "Fido" }, { name: "Rex" }] });

//     match(
//       { "animals.dogs.name": "Fido" },
//       {
//         animals: [{ dogs: { name: "Rex" } },
//           { dogs: { name: "Fido" } }]
//       }
//     );
//     nomatch({ "dogs.name": "Fido" }, { dogs: [] });

//     // $elemMatch
//     match(
//       { dogs: { $elemMatch: { name: /e/ } } },
//       { dogs: [{ name: "Fido" }, { name: "Rex" }] }
//     );
//     nomatch(
//       { dogs: { $elemMatch: { name: /a/ } } },
//       { dogs: [{ name: "Fido" }, { name: "Rex" }] }
//     );
//     match(
//       { dogs: { $elemMatch: { age: { $gt: 4 } } } },
//       { dogs: [{ name: "Fido", age: 5 }, { name: "Rex", age: 3 }] }
//     );
//     match(
//       { dogs: { $elemMatch: { name: "Fido", age: { $gt: 4 } } } },
//       { dogs: [{ name: "Fido", age: 5 }, { name: "Rex", age: 3 }] }
//     );
//     nomatch(
//       { dogs: { $elemMatch: { name: "Fido", age: { $gt: 5 } } } },
//       { dogs: [{ name: "Fido", age: 5 }, { name: "Rex", age: 3 }] }
//     );
//     match(
//       { dogs: { $elemMatch: { name: /i/, age: { $gt: 4 } } } },
//       { dogs: [{ name: "Fido", age: 5 }, { name: "Rex", age: 3 }] }
//     );
//     nomatch(
//       { dogs: { $elemMatch: { name: /e/, age: 5 } } },
//       { dogs: [{ name: "Fido", age: 5 }, { name: "Rex", age: 3 }] }
//     );

//     // Tests for https://github.com/meteor/meteor/issues/9111.
//     match(
//       { dogs: { $elemMatch: { name: "Rex" } } },
//       { dogs: [{ name: "Rex", age: 3 }] }
//     );
//     nomatch(
//       { dogs: { $not: { $elemMatch: { name: "Rex" } } } },
//       { dogs: [{ name: "Rex", age: 3 }] }
//     );
//     match({
//       $or: [
//         { dogs: { $elemMatch: { name: "Rex" } } },
//         { dogs: { $elemMatch: { name: "Rex", age: 5 } } }
//       ]
//     }, {
//       dogs: [{ name: "Rex", age: 3 }]
//     });
//     nomatch({
//       $or: [
//         { dogs: { $not: { $elemMatch: { name: "Rex" } } } },
//         { dogs: { $elemMatch: { name: "Rex", age: 5 } } }
//       ]
//     }, {
//       dogs: [{ name: "Rex", age: 3 }]
//     });

//     match({ x: { $elemMatch: { y: 9 } } }, { x: [{ y: 9 }] });
//     match({ x: { $elemMatch: { $gt: 5, $lt: 9 } } }, { x: [8] });
//     match(
//       { "a.x": { $elemMatch: { y: 9 } } },
//       { a: [{ x: [] }, { x: [{ y: 9 }] }] }
//     );
//     match({ a: { $elemMatch: { 0: { $gt: 5, $lt: 9 } } } }, { a: [[6]] });
//     match({ a: { $elemMatch: { "0.b": { $gt: 5, $lt: 9 } } } }, { a: [[{ b: 6 }]] });
//     match(
//       { a: { $elemMatch: { x: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ x: 1, b: 1 }] }
//     );
//     match(
//       { a: { $elemMatch: { $or: [{ a: 1 }, { b: 1 }], x: 1 } } },
//       { a: [{ x: 1, b: 1 }] }
//     );
//     match(
//       { a: { $elemMatch: { $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ x: 1, b: 1 }] }
//     );
//     match(
//       { a: { $elemMatch: { $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ x: 1, b: 1 }] }
//     );
//     match(
//       { a: { $elemMatch: { $and: [{ b: 1 }, { x: 1 }] } } },
//       { a: [{ x: 1, b: 1 }] },
//       true
//     );
//     nomatch(
//       { a: { $elemMatch: { x: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ b: 1 }] }
//     );
//     nomatch(
//       { a: { $elemMatch: { x: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ x: 1 }] }
//     );
//     nomatch(
//       { a: { $elemMatch: { x: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//       { a: [{ x: 1 }, { b: 1 }] }
//     );

//     throws(() => {
//       match(
//         { a: { $elemMatch: { $gte: 1, $or: [{ a: 1 }, { b: 1 }] } } },
//         { a: [{ x: 1, b: 1 }] }
//       );
//     });

//     throws(() => {
//       match({ x: { $elemMatch: { $and: [{ $gt: 5, $lt: 9 }] } } }, { x: [8] });
//     });

//     // $comment
//     match({ a: 5, $comment: "asdf" }, { a: 5 });
//     nomatch({ a: 6, $comment: "asdf" }, { a: 5 });
//   });
// });
