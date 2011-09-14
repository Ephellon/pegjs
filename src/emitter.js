/* Emits the generated code for the AST. */
PEG.compiler.emitter = function(ast) {
  /*
   * Takes parts of code, interpolates variables inside them and joins them with
   * a newline.
   *
   * Variables are delimited with "${" and "}" and their names must be valid
   * identifiers (i.e. they must match [a-zA-Z_][a-zA-Z0-9_]*). Variable values
   * are specified as properties of the last parameter (if this is an object,
   * otherwise empty variable set is assumed). Undefined variables result in
   * throwing |Error|.
   *
   * There can be a filter specified after the variable name, prefixed with "|".
   * The filter name must be a valid identifier. The only recognized filter
   * right now is "string", which quotes the variable value as a JavaScript
   * string. Unrecognized filters result in throwing |Error|.
   *
   * If any part has multiple lines and the first line is indented by some
   * amount of whitespace (as defined by the /\s+/ JavaScript regular
   * expression), second to last lines are indented by the same amount of
   * whitespace. This results in nicely indented multiline code in variables
   * without making the templates look ugly.
   *
   * Examples:
   *
   *   formatCode("foo", "bar");                           // "foo\nbar"
   *   formatCode("foo", "${bar}", { bar: "baz" });        // "foo\nbaz"
   *   formatCode("foo", "${bar}");                        // throws Error
   *   formatCode("foo", "${bar|string}", { bar: "baz" }); // "foo\n\"baz\""
   *   formatCode("foo", "${bar|eeek}", { bar: "baz" });   // throws Error
   *   formatCode("foo", "${bar}", { bar: "  baz\nqux" }); // "foo\n  baz\n  qux"
   */
  function formatCode() {
    function interpolateVariablesInParts(parts) {
      return map(parts, function(part) {
        return part.replace(
          /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(\|([a-zA-Z_][a-zA-Z0-9_]*))?\}/g,
          function(match, name, dummy, filter) {
            var value = vars[name];
            if (value === undefined) {
              throw new Error("Undefined variable: \"" + name + "\".");
            }

            if (filter !== undefined && filter !== "") { // JavaScript engines differ here.
              if (filter === "string") {
                return quote(value);
              } else {
                throw new Error("Unrecognized filter: \"" + filter + "\".");
              }
            } else {
              return value;
            }
          }
        );
      });
    }

    function indentMultilineParts(parts) {
      return map(parts, function(part) {
        if (!/\n/.test(part)) { return part; }

        var firstLineWhitespacePrefix = part.match(/^\s*/)[0];
        var lines = part.split("\n");
        var linesIndented = [lines[0]].concat(
          map(lines.slice(1), function(line) {
            return firstLineWhitespacePrefix + line;
          })
        );
        return linesIndented.join("\n");
      });
    }

    var args = Array.prototype.slice.call(arguments);
    var vars = args[args.length - 1] instanceof Object ? args.pop() : {};

    return indentMultilineParts(interpolateVariablesInParts(args)).join("\n");
  };

  function resultVar(index) { return "result" + index; }
  function posVar(index)    { return "pos"    + index; }

  var emit = buildNodeVisitor({
    grammar: function(node) {
      var initializerCode = node.initializer !== null
        ? emit(node.initializer)
        : "";

      var parseFunctionTableItems = [];
      for (var name in node.rules) {
        parseFunctionTableItems.push(quote(name) + ": parse_" + name);
      }
      parseFunctionTableItems.sort();

      var parseFunctionDefinitions = [];
      for (var name in node.rules) {
        parseFunctionDefinitions.push(emit(node.rules[name]));
      }

      return formatCode(
        "(function(){",
        "  /* Generated by PEG.js @VERSION (http://pegjs.majda.cz/). */",
        "  ",
        "  var result = {",
        "    /*",
        "     * Parses the input with a generated parser. If the parsing is successfull,",
        "     * returns a value explicitly or implicitly specified by the grammar from",
        "     * which the parser was generated (see |PEG.buildParser|). If the parsing is",
        "     * unsuccessful, throws |PEG.parser.SyntaxError| describing the error.",
        "     */",
        "    parse: function(input, startRule) {",
        "      var parseFunctions = {",
        "        ${parseFunctionTableItems}",
        "      };",
        "      ",
        "      if (startRule !== undefined) {",
        "        if (parseFunctions[startRule] === undefined) {",
        "          throw new Error(\"Invalid rule name: \" + quote(startRule) + \".\");",
        "        }",
        "      } else {",
        "        startRule = ${startRule|string};",
        "      }",
        "      ",
        "      var pos = 0;",
        "      var reportFailures = 0;", // 0 = report, anything > 0 = do not report
        "      var rightmostFailuresPos = 0;",
        "      var rightmostFailuresExpected = [];",
        "      var cache = {};",
        "      ",
        /* This needs to be in sync with |padLeft| in utils.js. */
        "      function padLeft(input, padding, length) {",
        "        var result = input;",
        "        ",
        "        var padLength = length - input.length;",
        "        for (var i = 0; i < padLength; i++) {",
        "          result = padding + result;",
        "        }",
        "        ",
        "        return result;",
        "      }",
        "      ",
        /* This needs to be in sync with |escape| in utils.js. */
        "      function escape(ch) {",
        "        var charCode = ch.charCodeAt(0);",
        "        var escapeChar;",
        "        var length;",
        "        ",
        "        if (charCode <= 0xFF) {",
        "          escapeChar = 'x';",
        "          length = 2;",
        "        } else {",
        "          escapeChar = 'u';",
        "          length = 4;",
        "        }",
        "        ",
        "        return '\\\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), '0', length);",
        "      }",
        "      ",
        /* This needs to be in sync with |quote| in utils.js. */
        "      function quote(s) {",
        "        /*",
        "         * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a",
        "         * string literal except for the closing quote character, backslash,",
        "         * carriage return, line separator, paragraph separator, and line feed.",
        "         * Any character may appear in the form of an escape sequence.",
        "         *",
        "         * For portability, we also escape escape all control and non-ASCII",
        "         * characters. Note that \"\\0\" and \"\\v\" escape sequences are not used",
        "         * because JSHint does not like the first and IE the second.",
        "         */",
        "        return '\"' + s",
        "          .replace(/\\\\/g, '\\\\\\\\')  // backslash",
        "          .replace(/\"/g, '\\\\\"')    // closing quote character",
        "          .replace(/\\x08/g, '\\\\b') // backspace",
        "          .replace(/\\t/g, '\\\\t')   // horizontal tab",
        "          .replace(/\\n/g, '\\\\n')   // line feed",
        "          .replace(/\\f/g, '\\\\f')   // form feed",
        "          .replace(/\\r/g, '\\\\r')   // carriage return",
        "          .replace(/[\\x00-\\x07\\x0B\\x0E-\\x1F\\x80-\\uFFFF]/g, escape)",
        "          + '\"';",
        "      }",
        "      ",
        "      function matchFailed(failure) {",
        "        if (pos < rightmostFailuresPos) {",
        "          return;",
        "        }",
        "        ",
        "        if (pos > rightmostFailuresPos) {",
        "          rightmostFailuresPos = pos;",
        "          rightmostFailuresExpected = [];",
        "        }",
        "        ",
        "        rightmostFailuresExpected.push(failure);",
        "      }",
        "      ",
        "      ${parseFunctionDefinitions}",
        "      ",
        "      function buildErrorMessage() {",
        "        function buildExpected(failuresExpected) {",
        "          failuresExpected.sort();",
        "          ",
        "          var lastFailure = null;",
        "          var failuresExpectedUnique = [];",
        "          for (var i = 0; i < failuresExpected.length; i++) {",
        "            if (failuresExpected[i] !== lastFailure) {",
        "              failuresExpectedUnique.push(failuresExpected[i]);",
        "              lastFailure = failuresExpected[i];",
        "            }",
        "          }",
        "          ",
        "          switch (failuresExpectedUnique.length) {",
        "            case 0:",
        "              return 'end of input';",
        "            case 1:",
        "              return failuresExpectedUnique[0];",
        "            default:",
        "              return failuresExpectedUnique.slice(0, failuresExpectedUnique.length - 1).join(', ')",
        "                + ' or '",
        "                + failuresExpectedUnique[failuresExpectedUnique.length - 1];",
        "          }",
        "        }",
        "        ",
        "        var expected = buildExpected(rightmostFailuresExpected);",
        "        var actualPos = Math.max(pos, rightmostFailuresPos);",
        "        var actual = actualPos < input.length",
        "          ? quote(input.charAt(actualPos))",
        "          : 'end of input';",
        "        ",
        "        return 'Expected ' + expected + ' but ' + actual + ' found.';",
        "      }",
        "      ",
        "      function computeErrorPosition() {",
        "        /*",
        "         * The first idea was to use |String.split| to break the input up to the",
        "         * error position along newlines and derive the line and column from",
        "         * there. However IE's |split| implementation is so broken that it was",
        "         * enough to prevent it.",
        "         */",
        "        ",
        "        var line = 1;",
        "        var column = 1;",
        "        var seenCR = false;",
        "        ",
        "        for (var i = 0; i <  rightmostFailuresPos; i++) {",
        "          var ch = input.charAt(i);",
        "          if (ch === '\\n') {",
        "            if (!seenCR) { line++; }",
        "            column = 1;",
        "            seenCR = false;",
        "          } else if (ch === '\\r' | ch === '\\u2028' || ch === '\\u2029') {",
        "            line++;",
        "            column = 1;",
        "            seenCR = true;",
        "          } else {",
        "            column++;",
        "            seenCR = false;",
        "          }",
        "        }",
        "        ",
        "        return { line: line, column: column };",
        "      }",
        "      ",
        "      ${initializerCode}",
        "      ",
        "      var result = parseFunctions[startRule]();",
        "      ",
        "      /*",
        "       * The parser is now in one of the following three states:",
        "       *",
        "       * 1. The parser successfully parsed the whole input.",
        "       *",
        "       *    - |result !== null|",
        "       *    - |pos === input.length|",
        "       *    - |rightmostFailuresExpected| may or may not contain something",
        "       *",
        "       * 2. The parser successfully parsed only a part of the input.",
        "       *",
        "       *    - |result !== null|",
        "       *    - |pos < input.length|",
        "       *    - |rightmostFailuresExpected| may or may not contain something",
        "       *",
        "       * 3. The parser did not successfully parse any part of the input.",
        "       *",
        "       *   - |result === null|",
        "       *   - |pos === 0|",
        "       *   - |rightmostFailuresExpected| contains at least one failure",
        "       *",
        "       * All code following this comment (including called functions) must",
        "       * handle these states.",
        "       */",
        "      if (result === null || pos !== input.length) {",
        "        var errorPosition = computeErrorPosition();",
        "        throw new this.SyntaxError(",
        "          buildErrorMessage(),",
        "          errorPosition.line,",
        "          errorPosition.column",
        "        );",
        "      }",
        "      ",
        "      return result;",
        "    },",
        "    ",
        "    /* Returns the parser source code. */",
        "    toSource: function() { return this._source; }",
        "  };",
        "  ",
        "  /* Thrown when a parser encounters a syntax error. */",
        "  ",
        "  result.SyntaxError = function(message, line, column) {",
        "    this.name = 'SyntaxError';",
        "    this.message = message;",
        "    this.line = line;",
        "    this.column = column;",
        "  };",
        "  ",
        "  result.SyntaxError.prototype = Error.prototype;",
        "  ",
        "  return result;",
        "})()",
        {
          initializerCode:          initializerCode,
          parseFunctionTableItems:  parseFunctionTableItems.join(",\n"),
          parseFunctionDefinitions: parseFunctionDefinitions.join("\n\n"),
          startRule:                node.startRule
        }
      );
    },

    initializer: function(node) {
      return node.code;
    },

    rule: function(node) {
      var context = {
        resultIndex: 0,
        posIndex:    0
      };

      var resultVars = map(range(node.resultStackDepth), resultVar);
      var posVars    = map(range(node.posStackDepth),    posVar);

      var resultVarsCode = resultVars.length > 0 ? "var " + resultVars.join(", ") + ";" : "";
      var posVarsCode    = posVars.length    > 0 ? "var " + posVars.join(", ")    + ";" : "";

      if (node.displayName !== null) {
        var setReportFailuresCode = formatCode(
          "reportFailures++;"
        );
        var restoreReportFailuresCode = formatCode(
          "reportFailures--;"
        );
        var reportFailureCode = formatCode(
          "if (reportFailures === 0 && ${resultVar} === null) {",
          "  matchFailed(${displayName|string});",
          "}",
          {
            displayName: node.displayName,
            resultVar:   resultVar(context.resultIndex)
          }
        );
      } else {
        var setReportFailuresCode = "";
        var restoreReportFailuresCode = "";
        var reportFailureCode = "";
      }

      return formatCode(
        "function parse_${name}() {",
        "  var cacheKey = '${name}@' + pos;",
        "  var cachedResult = cache[cacheKey];",
        "  if (cachedResult) {",
        "    pos = cachedResult.nextPos;",
        "    return cachedResult.result;",
        "  }",
        "  ",
        "  ${resultVarsCode}",
        "  ${posVarsCode}",
        "  ",
        "  ${setReportFailuresCode}",
        "  ${code}",
        "  ${restoreReportFailuresCode}",
        "  ${reportFailureCode}",
        "  ",
        "  cache[cacheKey] = {",
        "    nextPos: pos,",
        "    result:  ${resultVar}",
        "  };",
        "  return ${resultVar};",
        "}",
        {
          name:                      node.name,
          resultVarsCode:            resultVarsCode,
          posVarsCode:               posVarsCode,
          setReportFailuresCode:     setReportFailuresCode,
          restoreReportFailuresCode: restoreReportFailuresCode,
          reportFailureCode:         reportFailureCode,
          code:                      emit(node.expression, context),
          resultVar:                 resultVar(context.resultIndex)
        }
      );
    },

    /*
     * The contract for all code fragments generated by the following functions
     * is as follows.
     *
     * The code fragment tries to match a part of the input starting with the
     * position indicated in |pos|. That position may point past the end of the
     * input.
     *
     * * If the code fragment matches the input, it advances |pos| to point to
     *   the first chracter following the matched part of the input and sets
     *   variable with a name computed by calling
     *   |resultVar(context.resultIndex)| to an appropriate value. This value is
     *   always non-|null|.
     *
     * * If the code fragment does not match the input, it returns with |pos|
     *   set to the original value and it sets a variable with a name computed
     *   by calling |resultVar(context.resultIndex)| to |null|.
     *
     * The code can use variables with names computed by calling
     *
     *   |resultVar(context.resultIndex + i)|
     *
     * and
     *
     *   |posVar(context.posIndex + i)|
     *
     * where |i| >= 1 to store necessary data (return values and positions). It
     * won't use any other variables.
     */

    choice: function(node, context) {
      var code, nextAlternativesCode;

      for (var i = node.alternatives.length - 1; i >= 0; i--) {
        nextAlternativesCode = i !== node.alternatives.length - 1
          ? formatCode(
              "if (${resultVar} === null) {",
              "  ${code}",
              "}",
              {
                code:      code,
                resultVar: resultVar(context.resultIndex)
              }
            )
          : "";
        code = formatCode(
          "${currentAlternativeCode}",
          "${nextAlternativesCode}",
          {
            currentAlternativeCode: emit(node.alternatives[i], context),
            nextAlternativesCode:   nextAlternativesCode
          }
        );
      }

      return code;
    },

    sequence: function(node, context) {
      var elementResultVars = map(node.elements, function(element, i) {
        return resultVar(context.resultIndex + i);
      });

      var code = formatCode(
        "${resultVar} = ${elementResultVarArray};",
        {
          resultVar:             resultVar(context.resultIndex),
          elementResultVarArray: "[" + elementResultVars.join(", ") + "]"
        }
      );
      var elementContext;

      for (var i = node.elements.length - 1; i >= 0; i--) {
        elementContext = {
          resultIndex: context.resultIndex + i,
          posIndex:    context.posIndex + 1
        };
        code = formatCode(
          "${elementCode}",
          "if (${elementResultVar} !== null) {",
          "  ${code}",
          "} else {",
          "  ${resultVar} = null;",
          "  pos = ${posVar};",
          "}",
          {
            elementCode:      emit(node.elements[i], elementContext),
            elementResultVar: elementResultVars[i],
            code:             code,
            posVar:           posVar(context.posIndex),
            resultVar:        resultVar(context.resultIndex)
          }
        );
      }

      return formatCode(
        "${posVar} = pos;",
        "${code}",
        {
          code:   code,
          posVar: posVar(context.posIndex)
        }
      );
    },

    labeled: function(node, context) {
      return emit(node.expression, context);
    },

    simple_and: function(node, context) {
      var expressionContext = {
        resultIndex: context.resultIndex,
        posIndex:    context.posIndex + 1
      };

      return formatCode(
        "${posVar} = pos;",
        "reportFailures++;",
        "${expressionCode}",
        "reportFailures--;",
        "if (${resultVar} !== null) {",
        "  ${resultVar} = '';",
        "  pos = ${posVar};",
        "} else {",
        "  ${resultVar} = null;",
        "}",
        {
          expressionCode: emit(node.expression, expressionContext),
          posVar:         posVar(context.posIndex),
          resultVar:      resultVar(context.resultIndex)
        }
      );
    },

    simple_not: function(node, context) {
      var expressionContext = {
        resultIndex: context.resultIndex,
        posIndex:    context.posIndex + 1
      };

      return formatCode(
        "${posVar} = pos;",
        "reportFailures++;",
        "${expressionCode}",
        "reportFailures--;",
        "if (${resultVar} === null) {",
        "  ${resultVar} = '';",
        "} else {",
        "  ${resultVar} = null;",
        "  pos = ${posVar};",
        "}",
        {
          expressionCode: emit(node.expression, expressionContext),
          posVar:         posVar(context.posIndex),
          resultVar:      resultVar(context.resultIndex)
        }
      );
    },

    semantic_and: function(node, context) {
      return formatCode(
        "${resultVar} = (function() {${actionCode}})() ? '' : null;",
        {
          actionCode: node.code,
          resultVar:  resultVar(context.resultIndex)
        }
      );
    },

    semantic_not: function(node, context) {
      return formatCode(
        "${resultVar} = (function() {${actionCode}})() ? null : '';",
        {
          actionCode: node.code,
          resultVar:  resultVar(context.resultIndex)
        }
      );
    },

    optional: function(node, context) {
      return formatCode(
        "${expressionCode}",
        "${resultVar} = ${resultVar} !== null ? ${resultVar} : '';",
        {
          expressionCode: emit(node.expression, context),
          resultVar:      resultVar(context.resultIndex)
        }
      );
    },

    zero_or_more: function(node, context) {
      var expressionContext = {
        resultIndex: context.resultIndex + 1,
        posIndex:    context.posIndex
      };

      return formatCode(
        "${resultVar} = [];",
        "${expressionCode}",
        "while (${expressionResultVar} !== null) {",
        "  ${resultVar}.push(${expressionResultVar});",
        "  ${expressionCode}",
        "}",
        {
          expressionCode:      emit(node.expression, expressionContext),
          expressionResultVar: resultVar(context.resultIndex + 1),
          resultVar:           resultVar(context.resultIndex)
        }
      );
    },

    one_or_more: function(node, context) {
      var expressionContext = {
        resultIndex: context.resultIndex + 1,
        posIndex:    context.posIndex
      };

      return formatCode(
        "${expressionCode}",
        "if (${expressionResultVar} !== null) {",
        "  ${resultVar} = [];",
        "  while (${expressionResultVar} !== null) {",
        "    ${resultVar}.push(${expressionResultVar});",
        "    ${expressionCode}",
        "  }",
        "} else {",
        "  ${resultVar} = null;",
        "}",
        {
          expressionCode:      emit(node.expression, expressionContext),
          expressionResultVar: resultVar(context.resultIndex + 1),
          resultVar:           resultVar(context.resultIndex)
        }
      );
    },

    action: function(node, context) {
      /*
       * In case of sequences, we splat their elements into function arguments
       * one by one. Example:
       *
       *   start: a:"a" b:"b" c:"c" { alert(arguments.length) }  // => 3
       *
       * This behavior is reflected in this function.
       */

      var expressionContext = {
        resultIndex: context.resultIndex,
        posIndex:    context.posIndex + 1
      };

      if (node.expression.type === "sequence") {
        var formalParams = [];
        var actualParams = [];

        var elements = node.expression.elements;
        var elementsLength = elements.length;
        for (var i = 0; i < elementsLength; i++) {
          if (elements[i].type === "labeled") {
            formalParams.push(elements[i].label);
            actualParams.push(resultVar(context.resultIndex) + "[" + i + "]");
          }
        }
      } else if (node.expression.type === "labeled") {
        var formalParams = [node.expression.label];
        var actualParams = [resultVar(context.resultIndex)];
      } else {
        var formalParams = [];
        var actualParams = [];
      }

      return formatCode(
        "${posVar} = pos;",
        "${expressionCode}",
        "if (${resultVar} !== null) {",
        "  ${resultVar} = (function(${formalParams}) {${actionCode}})(${actualParams});",
        "}",
        "if (${resultVar} === null) {",
        "  pos = ${posVar};",
        "}",
        {
          expressionCode: emit(node.expression, expressionContext),
          actionCode:     node.code,
          formalParams:   formalParams.join(", "),
          actualParams:   actualParams.join(", "),
          posVar:         posVar(context.posIndex),
          resultVar:      resultVar(context.resultIndex)
        }
      );
    },

    rule_ref: function(node, context) {
      return formatCode(
        "${resultVar} = ${ruleMethod}();",
        {
          ruleMethod: "parse_" + node.name,
          resultVar:  resultVar(context.resultIndex)
        }
      );
    },

    literal: function(node, context) {
      var length = node.value.length;
      var testCode = length === 1
        ? formatCode(
            "input.charCodeAt(pos) === ${valueCharCode}",
            { valueCharCode: node.value.charCodeAt(0) }
          )
        : formatCode(
            "input.substr(pos, ${length}) === ${value|string}",
            {
              value:  node.value,
              length: length
            }
          );

      return formatCode(
        "if (${testCode}) {",
        "  ${resultVar} = ${value|string};",
        "  pos += ${length};",
        "} else {",
        "  ${resultVar} = null;",
        "  if (reportFailures === 0) {",
        "    matchFailed(${valueQuoted|string});",
        "  }",
        "}",
        {
          testCode:    testCode,
          value:       node.value,
          valueQuoted: quote(node.value),
          length:      length,
          resultVar:   resultVar(context.resultIndex)
        }
      );
    },

    any: function(node, context) {
      return formatCode(
        "if (input.length > pos) {",
        "  ${resultVar} = input.charAt(pos);",
        "  pos++;",
        "} else {",
        "  ${resultVar} = null;",
        "  if (reportFailures === 0) {",
        "    matchFailed('any character');",
        "  }",
        "}",
        { resultVar: resultVar(context.resultIndex) }
      );
    },

    "class": function(node, context) {
      if (node.parts.length > 0) {
        var regexp = "/^["
          + (node.inverted ? "^" : "")
          + map(node.parts, function(part) {
              return part instanceof Array
                ? quoteForRegexpClass(part[0])
                  + "-"
                  + quoteForRegexpClass(part[1])
                : quoteForRegexpClass(part);
            }).join("")
          + "]/";
      } else {
        /*
         * Stupid IE considers regexps /[]/ and /[^]/ syntactically invalid, so
         * we translate them into euqivalents it can handle.
         */
        var regexp = node.inverted ? "/^[\\S\\s]/" : "/^(?!)/";
      }

      return formatCode(
        "if (${regexp}.test(input.charAt(pos))) {",
        "  ${resultVar} = input.charAt(pos);",
        "  pos++;",
        "} else {",
        "  ${resultVar} = null;",
        "  if (reportFailures === 0) {",
        "    matchFailed(${rawText|string});",
        "  }",
        "}",
        {
          regexp:    regexp,
          rawText:   node.rawText,
          resultVar: resultVar(context.resultIndex)
        }
      );
    }
  });

  return emit(ast);
};
