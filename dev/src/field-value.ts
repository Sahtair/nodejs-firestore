/*!
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as firestore from '@google-cloud/firestore';

import * as deepEqual from 'fast-deep-equal';

import * as proto from '../protos/firestore_v1_proto_api';

import {FieldPath} from './path';
import {Serializer, validateUserInput} from './serializer';
import {
  invalidArgumentMessage,
  validateMinNumberOfArguments,
  validateNumber,
} from './validate';

import api = proto.google.firestore.v1;

/**
 * Sentinel values that can be used when writing documents with set(), create()
 * or update().
 *
 * @class FieldValue
 */
export class FieldValue implements firestore.FieldValue {
  /**
   * @hideconstructor
   */
  constructor() {}

  /**
   * Returns a sentinel for use with update() or set() with {merge:true} to mark
   * a field for deletion.
   *
   * @returns {FieldValue} The sentinel value to use in your objects.
   *
   * @example
   * let documentRef = firestore.doc('col/doc');
   * let data = { a: 'b', c: 'd' };
   *
   * documentRef.set(data).then(() => {
   *   return documentRef.update({a: Firestore.FieldValue.delete()});
   * }).then(() => {
   *   // Document now only contains { c: 'd' }
   * });
   */
  static delete(): FieldValue {
    return DeleteTransform.DELETE_SENTINEL;
  }

  /**
   * Returns a sentinel used with set(), create() or update() to include a
   * server-generated timestamp in the written data.
   *
   * @return {FieldValue} The FieldValue sentinel for use in a call to set(),
   * create() or update().
   *
   * @example
   * let documentRef = firestore.doc('col/doc');
   *
   * documentRef.set({
   *   time: Firestore.FieldValue.serverTimestamp()
   * }).then(() => {
   *   return documentRef.get();
   * }).then(doc => {
   *   console.log(`Server time set to ${doc.get('time')}`);
   * });
   */
  static serverTimestamp(): FieldValue {
    return ServerTimestampTransform.SERVER_TIMESTAMP_SENTINEL;
  }

  /**
   * Returns a special value that can be used with set(), create() or update()
   * that tells the server to increment the the field's current value by the
   * given value.
   *
   * If either current field value or the operand uses floating point
   * precision, both values will be interpreted as floating point numbers and
   * all arithmetic will follow IEEE 754 semantics. Otherwise, integer
   * precision is kept and the result is capped between -2^63 and 2^63-1.
   *
   * If the current field value is not of type 'number', or if the field does
   * not yet exist, the transformation will set the field to the given value.
   *
   * @param {number} n The value to increment by.
   * @return {FieldValue} The FieldValue sentinel for use in a call to set(),
   * create() or update().
   *
   * @example
   * let documentRef = firestore.doc('col/doc');
   *
   * documentRef.update(
   *   'counter', Firestore.FieldValue.increment(1)
   * ).then(() => {
   *   return documentRef.get();
   * }).then(doc => {
   *   // doc.get('counter') was incremented
   * });
   */
  static increment(n: number): FieldValue {
    // eslint-disable-next-line prefer-rest-params
    validateMinNumberOfArguments('FieldValue.increment', arguments, 1);
    return new NumericIncrementTransform(n);
  }

  /**
   * Returns a special value that can be used with set(), create() or update()
   * that tells the server to union the given elements with any array value that
   * already exists on the server. Each specified element that doesn't already
   * exist in the array will be added to the end. If the field being modified is
   * not already an array it will be overwritten with an array containing
   * exactly the specified elements.
   *
   * @param {...*} elements The elements to union into the array.
   * @return {FieldValue} The FieldValue sentinel for use in a call to set(),
   * create() or update().
   *
   * @example
   * let documentRef = firestore.doc('col/doc');
   *
   * documentRef.update(
   *   'array', Firestore.FieldValue.arrayUnion('foo')
   * ).then(() => {
   *   return documentRef.get();
   * }).then(doc => {
   *   // doc.get('array') contains field 'foo'
   * });
   */
  static arrayUnion(...elements: unknown[]): FieldValue {
    validateMinNumberOfArguments('FieldValue.arrayUnion', elements, 1);
    return new ArrayUnionTransform(elements);
  }

  /**
   * Returns a special value that can be used with set(), create() or update()
   * that tells the server to remove the given elements from any array value
   * that already exists on the server. All instances of each element specified
   * will be removed from the array. If the field being modified is not already
   * an array it will be overwritten with an empty array.
   *
   * @param {...*} elements The elements to remove from the array.
   * @return {FieldValue} The FieldValue sentinel for use in a call to set(),
   * create() or update().
   *
   * @example
   * let documentRef = firestore.doc('col/doc');
   *
   * documentRef.update(
   *   'array', Firestore.FieldValue.arrayRemove('foo')
   * ).then(() => {
   *   return documentRef.get();
   * }).then(doc => {
   *   // doc.get('array') no longer contains field 'foo'
   * });
   */
  static arrayRemove(...elements: unknown[]): FieldValue {
    validateMinNumberOfArguments('FieldValue.arrayRemove', elements, 1);
    return new ArrayRemoveTransform(elements);
  }

  /**
   * Returns true if this `FieldValue` is equal to the provided value.
   *
   * @param {*} other The value to compare against.
   * @return {boolean} true if this `FieldValue` is equal to the provided value.
   *
   * @example
   * let fieldValues = [
   *   Firestore.FieldValue.increment(-1.0),
   *   Firestore.FieldValue.increment(-1),
   *   Firestore.FieldValue.increment(-0.0),
   *   Firestore.FieldValue.increment(-0),
   *   Firestore.FieldValue.increment(0),
   *   Firestore.FieldValue.increment(0.0),
   *   Firestore.FieldValue.increment(1),
   *   Firestore.FieldValue.increment(1.0)
   * ];
   *
   * let equal = 0;
   * for (let i = 0; i < fieldValues.length; ++i) {
   *   for (let j = i + 1; j < fieldValues.length; ++j) {
   *     if (fieldValues[i].isEqual(fieldValues[j])) {
   *       ++equal;
   *     }
   *   }
   * }
   * console.log(`Found ${equal} equalities.`);
   */
  isEqual(other: firestore.FieldValue): boolean {
    return this === other;
  }
}

/**
 * An internal interface shared by all field transforms.
 *
 * A 'FieldTransform` subclass should implement '.includeInDocumentMask',
 * '.includeInDocumentTransform' and 'toProto' (if '.includeInDocumentTransform'
 * is 'true').
 *
 * @private
 * @internal
 * @abstract
 */
export abstract class FieldTransform extends FieldValue {
  /** Whether this FieldTransform should be included in the document mask. */
  abstract get includeInDocumentMask(): boolean;

  /**
   * Whether this FieldTransform should be included in the list of document
   * transforms.
   */
  abstract get includeInDocumentTransform(): boolean;

  /** The method name used to obtain the field transform. */
  abstract get methodName(): string;

  /**
   * Performs input validation on the values of this field transform.
   *
   * @param allowUndefined Whether to allow nested properties that are `undefined`.
   */
  abstract validate(allowUndefined: boolean): void;

  /***
   * The proto representation for this field transform.
   *
   * @param serializer The Firestore serializer.
   * @param fieldPath The field path to apply this transformation to.
   * @return The 'FieldTransform' proto message.
   */
  abstract toProto(
    serializer: Serializer,
    fieldPath: FieldPath
  ): api.DocumentTransform.IFieldTransform;
}

/**
 * A transform that deletes a field from a Firestore document.
 *
 * @private
 * @internal
 */
export class DeleteTransform extends FieldTransform {
  /**
   * Sentinel value for a field delete.
   * @private
   * @internal
   */
  static DELETE_SENTINEL = new DeleteTransform();

  private constructor() {
    super();
  }

  /**
   * Deletes are included in document masks.
   * @private
   * @internal
   */
  get includeInDocumentMask(): true {
    return true;
  }

  /**
   * Deletes are are omitted from document transforms.
   * @private
   * @internal
   */
  get includeInDocumentTransform(): false {
    return false;
  }

  get methodName(): string {
    return 'FieldValue.delete';
  }

  validate(): void {}

  toProto(): never {
    throw new Error(
      'FieldValue.delete() should not be included in a FieldTransform'
    );
  }
}

/**
 * A transform that sets a field to the Firestore server time.
 *
 * @private
 * @internal
 */
class ServerTimestampTransform extends FieldTransform {
  /**
   * Sentinel value for a server timestamp.
   *
   * @private
   * @internal
   */
  static SERVER_TIMESTAMP_SENTINEL = new ServerTimestampTransform();

  private constructor() {
    super();
  }

  /**
   * Server timestamps are omitted from document masks.
   *
   * @private
   * @internal
   */
  get includeInDocumentMask(): false {
    return false;
  }

  /**
   * Server timestamps are included in document transforms.
   *
   * @private
   * @internal
   */
  get includeInDocumentTransform(): true {
    return true;
  }

  get methodName(): string {
    return 'FieldValue.serverTimestamp';
  }

  validate(): void {}

  toProto(
    serializer: Serializer,
    fieldPath: FieldPath
  ): api.DocumentTransform.IFieldTransform {
    return {
      fieldPath: fieldPath.formattedName,
      setToServerValue: 'REQUEST_TIME',
    };
  }
}

/**
 * Increments a field value on the backend.
 *
 * @private
 * @internal
 */
class NumericIncrementTransform extends FieldTransform {
  constructor(private readonly operand: number) {
    super();
  }

  /**
   * Numeric transforms are omitted from document masks.
   *
   * @private
   * @internal
   */
  get includeInDocumentMask(): false {
    return false;
  }

  /**
   * Numeric transforms are included in document transforms.
   *
   * @private
   * @internal
   */
  get includeInDocumentTransform(): true {
    return true;
  }

  get methodName(): string {
    return 'FieldValue.increment';
  }

  validate(): void {
    validateNumber('FieldValue.increment()', this.operand);
  }

  toProto(
    serializer: Serializer,
    fieldPath: FieldPath
  ): api.DocumentTransform.IFieldTransform {
    const encodedOperand = serializer.encodeValue(this.operand)!;
    return {fieldPath: fieldPath.formattedName, increment: encodedOperand};
  }

  isEqual(other: firestore.FieldValue): boolean {
    return (
      this === other ||
      (other instanceof NumericIncrementTransform &&
        this.operand === other.operand)
    );
  }
}

/**
 * Transforms an array value via a union operation.
 *
 * @private
 * @internal
 */
class ArrayUnionTransform extends FieldTransform {
  constructor(private readonly elements: unknown[]) {
    super();
  }

  /**
   * Array transforms are omitted from document masks.
   * @private
   * @internal
   */
  get includeInDocumentMask(): false {
    return false;
  }

  /**
   * Array transforms are included in document transforms.
   * @private
   * @internal
   */
  get includeInDocumentTransform(): true {
    return true;
  }

  get methodName(): string {
    return 'FieldValue.arrayUnion';
  }

  validate(allowUndefined: boolean): void {
    for (let i = 0; i < this.elements.length; ++i) {
      validateArrayElement(i, this.elements[i], allowUndefined);
    }
  }

  toProto(
    serializer: Serializer,
    fieldPath: FieldPath
  ): api.DocumentTransform.IFieldTransform {
    const encodedElements = serializer.encodeValue(this.elements)!.arrayValue!;
    return {
      fieldPath: fieldPath.formattedName,
      appendMissingElements: encodedElements,
    };
  }

  isEqual(other: firestore.FieldValue): boolean {
    return (
      this === other ||
      (other instanceof ArrayUnionTransform &&
        deepEqual(this.elements, other.elements))
    );
  }
}

/**
 * Transforms an array value via a remove operation.
 *
 * @private
 * @internal
 */
class ArrayRemoveTransform extends FieldTransform {
  constructor(private readonly elements: unknown[]) {
    super();
  }

  /**
   * Array transforms are omitted from document masks.
   * @private
   * @internal
   */
  get includeInDocumentMask(): false {
    return false;
  }

  /**
   * Array transforms are included in document transforms.
   * @private
   * @internal
   */
  get includeInDocumentTransform(): true {
    return true;
  }

  get methodName(): string {
    return 'FieldValue.arrayRemove';
  }

  validate(allowUndefined: boolean): void {
    for (let i = 0; i < this.elements.length; ++i) {
      validateArrayElement(i, this.elements[i], allowUndefined);
    }
  }

  toProto(
    serializer: Serializer,
    fieldPath: FieldPath
  ): api.DocumentTransform.IFieldTransform {
    const encodedElements = serializer.encodeValue(this.elements)!.arrayValue!;
    return {
      fieldPath: fieldPath.formattedName,
      removeAllFromArray: encodedElements,
    };
  }

  isEqual(other: firestore.FieldValue): boolean {
    return (
      this === other ||
      (other instanceof ArrayRemoveTransform &&
        deepEqual(this.elements, other.elements))
    );
  }
}

/**
 * Validates that `value` can be used as an element inside of an array. Certain
 * field values (such as ServerTimestamps) are rejected. Nested arrays are also
 * rejected.
 *
 * @private
 * @internal
 * @param arg The argument name or argument index (for varargs methods).
 * @param value The value to validate.
 * @param allowUndefined Whether to allow nested properties that are `undefined`.
 */
function validateArrayElement(
  arg: string | number,
  value: unknown,
  allowUndefined: boolean
): void {
  if (Array.isArray(value)) {
    throw new Error(
      `${invalidArgumentMessage(
        arg,
        'array element'
      )} Nested arrays are not supported.`
    );
  }
  validateUserInput(
    arg,
    value,
    'array element',
    /*path=*/ {allowDeletes: 'none', allowTransforms: false, allowUndefined},
    /*path=*/ undefined,
    /*level=*/ 0,
    /*inArray=*/ true
  );
}
